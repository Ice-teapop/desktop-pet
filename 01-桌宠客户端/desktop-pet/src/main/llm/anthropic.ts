/**
 * Anthropic Claude 客户端封装 —— 主进程 LLM 接入层。
 *
 * 设计：
 *  - 流式：messages.stream + .on('text') + .finalMessage() 完整 Message 收尾
 *  - 模型默认 claude-haiku-4-5（速度优先、便宜、对话场景最合适）
 *  - 错误用 typed exception 归类到 ChatError discriminated union（不字符串匹配）
 *  - API key 来源：safeStorage 加密落盘（M2-2）+ env var dev 后门
 *
 * M4-A-3 视觉 pivot 后：image 注入改成 tool use（agentic）—— AI 看用户问题自己
 * 决定要不要调 `view_screen` tool。stream() 跑一个工具循环：
 *   text-only → AI 答完 → 结束
 *   tool_use → main 截屏 → tool_result 推回 → AI 续答 → 结束
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatError, ChatMessage, ChatUsage, ModelId } from '../../shared/chat-types'

// 桌宠系统 prompt
const SYSTEM_PROMPT = `你是 DeskPet —— 一个住在用户桌面右下角的友善 AI 小伙伴（外形是一只像素螃蟹）。

风格：
- 简短、温暖、像朋友一样说话；不啰嗦不卖弄
- 中文为主；技术名词保留英文
- 直接回答问题，不要总结你做了什么
- 不主动给免责声明或"作为 AI 我..."这类开场白

# 屏幕感知（M4-A-3 agentic）

你有一个工具 view_screen —— 当用户的问题涉及他们当前屏幕 / 某个可见窗口 / 显示内容 /
UI 元素 时，调用它来获取当前屏幕截图（PNG）。

调用准则（保守，避免无谓 token）：
- 用户明确提"屏幕 / 这个 / 这里 / 这段 / 我看到的 / 这个 error" 等指代 → 调用
- 用户问的是纯通用问题（"1+1=", "讲个笑话", "你叫啥"）→ 不调用
- 模糊但可能要看的 → 倾向不调用，回问用户"指的是哪里"

调用后注意：
- 桌宠自己（像素螃蟹）可能在截图右下角 —— 看到自己时礼貌忽略
- 如果工具报错（"capture failed: ..."），告诉用户：很可能是 macOS 屏幕录制权限没给，
  让他到「系统设置 → 隐私与安全性 → 屏幕录制」勾选 Electron 并完全退出 DeskPet 重启

不需要看屏的对话按平常回，无需提"我有看屏工具"。`

const MAX_TOKENS = 1024
const MAX_TOOL_ITERATIONS = 3

// view_screen tool 定义 —— 跟 system prompt 双重保险描述使用场景
const VIEW_SCREEN_TOOL = {
  name: 'view_screen',
  description:
    "Capture the user's current screen as a PNG image. " +
    "ONLY call this tool when the user's question explicitly references " +
    'their screen, a visible window, displayed content, or a UI element ' +
    'they can see. DO NOT call this for general questions, math, jokes, ' +
    'definitions, or topics unrelated to what is currently on their screen.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: []
  }
}

export interface ChatChunkHandler {
  onChunk: (text: string) => void
  onDone: (usage: ChatUsage) => void
  onError: (err: ChatError) => void
}

/** 截屏回调返回 —— main 进程实现，注入到 stream() 让 LLM 工具循环用。 */
export type ScreenCaptureResult =
  | {
      ok: true
      data: string // base64
      mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    }
  | { ok: false; error: string }

export interface StreamOptions {
  /** 暴露 view_screen tool 给 AI（仅 visionEnabled+visionConsented 时 true） */
  enableVisionTool?: boolean
  /** 当 AI 调 view_screen 时，main 端实际截屏的实现 */
  captureScreen?: () => Promise<ScreenCaptureResult>
}

/** 返回给调用方的 abort 句柄 —— resetKey / 新 turn 接管时用来取消 in-flight stream。 */
export interface StreamHandle {
  abort(): void
}

export class AnthropicLlmClient {
  private client: Anthropic

  constructor(
    apiKey: string,
    private model: ModelId
  ) {
    this.client = new Anthropic({ apiKey })
  }

  /**
   * 同步发起流式请求 + tool 循环，立刻返回 abort 句柄；
   * handler 回调按 chunk / done / error 异步触发。
   *
   * Tool 循环模式：
   *   iter 1: 普通 messages 请求（带 view_screen 工具定义）
   *     → AI 直接答完 → 触发 onDone 退出
   *     → AI 决定 tool_use → 走 iter 2
   *   iter 2: messages 拼接 [assistant tool_use, user tool_result]
   *     → AI 看图答完 → 触发 onDone 退出
   *     → AI 又 tool_use（罕见 / 多张）→ 走 iter 3
   *   最多 MAX_TOOL_ITERATIONS 轮防死循环
   *
   * 主动 abort 触发的 catch 不报 onError —— abort 是上层有意为之。
   */
  stream(
    messages: ChatMessage[],
    handler: ChatChunkHandler,
    options: StreamOptions = {}
  ): StreamHandle {
    let aborted = false
    let activeSdkStream: ReturnType<Anthropic['messages']['stream']> | null = null

    void (async () => {
      // 内部 working messages —— 主进程 chatHistory 是 string content 的简化模型，
      // 这里需要 array-of-content-block 才能放 tool_use / tool_result。
      const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content
      }))

      let totalInputTokens = 0
      let totalOutputTokens = 0

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (aborted) return

        const tools = options.enableVisionTool ? [VIEW_SCREEN_TOOL] : undefined

        const sdkStream = this.client.messages.stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
          ...(tools ? { tools } : {})
        })
        activeSdkStream = sdkStream

        sdkStream.on('text', (delta) => {
          if (!aborted) handler.onChunk(delta)
        })

        let finalMessage: Anthropic.Messages.Message
        try {
          finalMessage = await sdkStream.finalMessage()
        } catch (err) {
          if (aborted || sdkStream.aborted) return
          handler.onError(classifyError(err))
          return
        }
        activeSdkStream = null
        if (aborted) return

        totalInputTokens += finalMessage.usage.input_tokens
        totalOutputTokens += finalMessage.usage.output_tokens

        // stop_reason 决定下一步
        if (finalMessage.stop_reason !== 'tool_use') {
          // 普通收尾：text 全 streamed，AI 决定结束
          handler.onDone({
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })
          return
        }

        // —— 进入 tool 循环 ——
        // 把 assistant 这轮（含 tool_use 块）整段加进 apiMessages
        apiMessages.push({ role: 'assistant', content: finalMessage.content })

        // 找所有 tool_use 块（通常 1 个，但 AI 理论上能一轮 multiple）
        const toolUses = finalMessage.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        )

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          if (tu.name !== 'view_screen') {
            // AI 编了个不存在的工具名 —— 报错回给 AI
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `Unknown tool: ${tu.name}. Available: view_screen.`,
              is_error: true
            })
            continue
          }
          if (!options.captureScreen) {
            // 不应发生：tool 暴露给 AI 必伴随 captureScreen 实现
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'capture not available in current build',
              is_error: true
            })
            continue
          }
          const cap = await options.captureScreen()
          if (aborted) return
          if (cap.ok) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: cap.mediaType,
                    data: cap.data
                  }
                }
              ]
            })
          } else {
            // 截屏失败（macOS 权限缺等）—— 把错误 string 回给 AI，按 system prompt
            // 它会自然告知用户检查权限
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `capture failed: ${cap.error}`,
              is_error: true
            })
          }
        }

        // 把 tool_result 作为 user 角色的下一条消息推入
        apiMessages.push({ role: 'user', content: toolResults })

        // 进入下一轮，让 AI 看到 tool_result 后续答
      }

      // 用满 iterations 还没结束 —— 防御性退出
      if (!aborted) {
        handler.onError({
          kind: 'unknown',
          message: `tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations`
        })
      }
    })()

    return {
      abort: () => {
        aborted = true
        activeSdkStream?.abort()
      }
    }
  }
}

/**
 * 把 SDK 抛出的 Error 归类为 ChatError discriminated union。
 * 用 typed exception 而非字符串匹配 —— Anthropic SDK 错误类型稳定可靠。
 */
function classifyError(err: unknown): ChatError {
  if (err instanceof Anthropic.AuthenticationError) {
    return { kind: 'invalid-api-key' }
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfterRaw = err.headers?.['retry-after']
    const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : undefined
    return { kind: 'rate-limited', retryAfterSec }
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: 'network' }
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return { kind: 'overloaded' }
    return { kind: 'api', message: err.message }
  }
  if (err instanceof Error) {
    return { kind: 'unknown', message: err.message }
  }
  return { kind: 'unknown', message: String(err) }
}

/** 开发后门：env var 优先于加密文件，让本地调试不用反复输 key。 */
export function getApiKeyFromEnv(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY?.trim()
  return raw && raw.length > 0 ? raw : null
}

/**
 * 粗判一段文本是不是 Anthropic key —— 拿来做"用户输入是 key 还是普通对话"的分流。
 * 上限 200 防御渲染层被绕过校验后发巨型字符串。
 */
export function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,200}$/.test(text.trim())
}
