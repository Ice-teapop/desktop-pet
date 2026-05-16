/**
 * Anthropic Claude 客户端封装 —— 主进程 LLM 接入层（M2-1）。
 *
 * 设计：
 *  - 流式：messages.stream + .on('text') + .finalMessage() 完整 Message 收尾
 *  - 模型默认 claude-haiku-4-5（速度优先、便宜、对话场景最合适）
 *  - 错误用 typed exception 归类到 ChatError discriminated union（不字符串匹配）
 *  - API key 来源：环境变量 ANTHROPIC_API_KEY（M2-1 临时；M2-2 加 safeStorage）
 *
 * Prompt caching 暂不做：Haiku 4.5 最小 cacheable prefix = 4096 tokens，
 * 桌宠系统 prompt + 短对话历史远不到 minimum；M3 接入大上下文（如视觉服务结果）
 * 时再加 cache_control。
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatError, ChatMessage, ChatUsage, ModelId } from '../../shared/chat-types'

// 桌宠系统 prompt —— 简短、有温度、不啰嗦
const SYSTEM_PROMPT = `你是 DeskPet —— 一个住在用户桌面右下角的友善 AI 小伙伴（外形是一只像素螃蟹）。

风格：
- 简短、温暖、像朋友一样说话；不啰嗦不卖弄
- 中文为主；技术名词保留英文
- 直接回答问题，不要总结你做了什么
- 不主动给免责声明或"作为 AI 我..."这类开场白`

// model 由调用方传入（来自 shared/chat-types 的 ModelId 白名单 + 用户偏好持久化）
const MAX_TOKENS = 1024

export interface ChatChunkHandler {
  onChunk: (text: string) => void
  onDone: (usage: ChatUsage) => void
  onError: (err: ChatError) => void
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
   * 同步发起流式请求，立刻返回 abort 句柄；handler 回调按 chunk / done / error 异步触发。
   *
   * 设计为同步返回（不是 Promise）—— 这样调用方在 turn 切换时能立刻拿到 handle 来 abort
   * 上一个 in-flight stream，否则 token 会一直烧到 Anthropic 把 stream 跑完为止。
   *
   * 主动 abort 触发的 catch 不报 onError —— 因为 abort 是上层有意为之，不算业务错误。
   */
  stream(messages: ChatMessage[], handler: ChatChunkHandler): StreamHandle {
    const sdkStream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    })

    sdkStream.on('text', (delta) => handler.onChunk(delta))

    void (async () => {
      try {
        const finalMessage = await sdkStream.finalMessage()
        if (sdkStream.aborted) return
        handler.onDone({
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens
        })
      } catch (err) {
        if (sdkStream.aborted) return
        handler.onError(classifyError(err))
      }
    })()

    return { abort: () => sdkStream.abort() }
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
    // 529 overloaded 没有专属 SDK class，用 status 区分
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
 * 上限 200 防御渲染层被绕过校验后发巨型字符串（contextBridge 默认无长度限制）。
 */
export function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,200}$/.test(text.trim())
}
