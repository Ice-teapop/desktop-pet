/**
 * Anthropic Claude 客户端封装 —— 主进程 LLM 接入层。
 *
 * 设计：
 *  - 流式：messages.stream + .on('text') + .finalMessage() 完整 Message 收尾
 *  - 模型默认 claude-haiku-4-5（速度优先、便宜、对话场景最合适）
 *  - 错误用 typed exception 归类到 ChatError discriminated union（不字符串匹配）
 *  - Tool 接口通用（LLM-agnostic）：调用方传 tools 定义 + executeTool dispatcher
 *
 * M4-A-4 加 tool 循环；M4-B 改成通用 tool 接口（不再 hardcoded view_screen）。
 *
 * Tool 循环模式：
 *   iter 1: 普通 messages 请求（带 tools 定义）
 *     → AI 答完 (stop_reason ≠ tool_use) → 触发 onDone 退出
 *     → AI 决定 tool_use → 走 iter 2
 *   iter 2: messages 拼接 [assistant tool_use, user tool_result]
 *     → AI 看 tool_result 答完 → 触发 onDone 退出
 *     → AI 又 tool_use → 走 iter 3
 *   最多 MAX_TOOL_ITERATIONS 轮防死循环
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatError, ChatMessage, ChatUsage, ModelId } from '../../shared/chat-types'
import type { ToolDef, ToolResult } from './tools'

// 桌宠系统 prompt
const SYSTEM_PROMPT = `你是 DeskPet —— 一个住在用户桌面右下角的友善 AI 小伙伴（外形是一只像素螃蟹）。

风格：
- 简短、温暖、像朋友一样说话；不啰嗦不卖弄
- 中文为主；技术名词保留英文
- 直接回答问题，不要总结你做了什么
- 不主动给免责声明或"作为 AI 我..."这类开场白

# 工具能力（M4-B agentic）

你可能拥有这些本地工具（具体可用看 tools 字段）：

- view_screen：截屏看 UI/文字/图像。问"屏幕上 / 这个窗口"类调；纯通用问题不调。
- read_clipboard：读剪贴板文本。"我刚复制的是啥"/"翻译我贴的"类调；
  看到密码/secret 这类敏感内容时简短答"看到了不便复述"，不要复读。
- open_url：打开浏览器到 URL。给完答案附带相关链接时主动调；用户没要求时不强推。
- copy_to_clipboard：把代码/命令/路径放剪贴板让用户 cmd+V。生成完用户明显要粘贴
  的内容时调，并简短告知"已放剪贴板可粘贴"。
- current_app_info：查用户当前前台 app + 活动。"我在干嘛"或要根据上下文给建议时调。

调用准则：
- 保守：不必要不调（每次调用都让用户多等 200~500ms + image token 烧钱）
- 顺手：能让用户少一步操作就调（例：AI 给了 ssh 命令 → 顺手 copy_to_clipboard）
- 出错友好：tool 报错（权限缺等）→ 告诉用户具体怎么修
- 看到桌宠自己（像素螃蟹，通常在屏幕右下角）：礼貌忽略

无需调工具的对话按平常回，不主动提你有什么工具。`

const MAX_TOKENS = 1024
const MAX_TOOL_ITERATIONS = 5

export interface ChatChunkHandler {
  onChunk: (text: string) => void
  onDone: (usage: ChatUsage) => void
  onError: (err: ChatError) => void
}

export interface StreamOptions {
  /** AI 可见的工具池（空 / undefined = 关掉所有 agentic 能力） */
  tools?: readonly ToolDef[]
  /** AI 调 tool 时 main 端的执行 dispatcher */
  executeTool?: (name: string, input: unknown) => Promise<ToolResult>
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
   * 同步发起流式请求 + tool 循环，立刻返回 abort 句柄。
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
      const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content
      }))

      let totalInputTokens = 0
      let totalOutputTokens = 0

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (aborted) return

        const tools = options.tools && options.tools.length > 0 ? options.tools : undefined

        const sdkStream = this.client.messages.stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
          ...(tools ? { tools: tools as Anthropic.Messages.Tool[] } : {})
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

        if (finalMessage.stop_reason !== 'tool_use') {
          handler.onDone({
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })
          return
        }

        // —— 处理 tool_use 块 ——
        apiMessages.push({ role: 'assistant', content: finalMessage.content })

        const toolUses = finalMessage.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        )

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          if (!options.executeTool) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'tool execution not available in current build',
              is_error: true
            })
            continue
          }
          const result = await options.executeTool(tu.name, tu.input)
          if (aborted) return
          if (result.ok) {
            // string content 走 string；array content（如 view_screen 的 image）走 array
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: result.content as
                | string
                | Anthropic.Messages.ToolResultBlockParam['content']
            })
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: result.error,
              is_error: true
            })
          }
        }

        apiMessages.push({ role: 'user', content: toolResults })
      }

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
 * 粗判一段文本是不是 Anthropic key。
 */
export function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,200}$/.test(text.trim())
}
