/**
 * Multi-provider LLM 客户端（M7-2）—— 替代旧 anthropic.ts。
 *
 * 设计：
 *  - 用 Vercel AI SDK `streamText` 跑统一 streaming + tool loop
 *  - tool 池由 tool-defs.ts buildToolSetForContext 动态构建（ToolSet object）
 *  - stopWhen: stepCountIs(MAX_TOOL_STEPS) 让 SDK 自动跑多步 tool 循环（防死循环）
 *  - abort 通过 AbortController 切给 SDK
 *  - 错误归类成跨 provider 通用的 ChatError discriminated union
 *
 * 跟 anthropic.ts 不同：
 *  - 不再手撸 apiMessages + tool_use/tool_result block 拼接（SDK 内部 handle）
 *  - 不依赖 @anthropic-ai/sdk 的 AuthenticationError / RateLimitError 等具体 class，
 *    改用 AI SDK 的 APICallError.isInstance + statusCode 做归类（跨 provider 通用）
 *
 * tool error 注意：tool execute() 内 throw 会被 SDK 自动转成 model 可见的
 * tool-error content part（不 break stream），AI 看到错误自然续答 —— 我们 wrapper
 * 已经这样做了。这里只处理 model/network/auth 这类 stream-level 错误。
 */
import { streamText, stepCountIs, APICallError, type LanguageModel, type ModelMessage } from 'ai'
import type { ChatError, ChatMessage, ChatUsage, ToolEvent } from '../../shared/chat-types'
import type { ToolContext } from './tools'
import { buildToolSetForContext } from './tool-defs'
import type { UserProfile } from '../../shared/user-profile-types'
import {
  getSystemPrompt,
  renderCurrentTimeSection,
  renderUserProfileSection,
  renderPersonaPreamble,
  renderSkillsSection,
  memoryInjectionWrapper,
  petStateInjection
} from './system-prompts'

// SYSTEM_PROMPT 主体 + ZH/EN 翻译版本已迁到 ./system-prompts.ts (LOCALE-switch).
// 通过 getSystemPrompt() / renderXxx() 函数获取，本文件不再持 const 文本。

/** AI SDK total step 上限（每个 user/tool turn = 1 step）—— 防 tool 死循环。
 *  从 5 抬到 15: 深 agentic 链 (find_files → read → web_search → fetch_url → write_file)
 *  常需 8-12 步; 5 步在中途被静默截断, 用户看到"思考停了"。 */
const MAX_TOOL_STEPS = 15

/**
 * 单步最大输出 token —— 按 model 区分:
 *   - Haiku: 2048 (短温暖快, 跟 DeskPet 定位匹配)
 *   - Opus / Sonnet 4.x: 8192 (复杂任务深推理, 1024 撞 max_tokens 是用户报"思考停"主因)
 *   - 其它 provider (OpenAI/Google/DeepSeek/xAI/ByteDance): 4096 中间值
 *
 * 不设的话 AI SDK 走 model 默认 (~8192) 不可控。
 */
function getMaxOutputTokensForModel(modelId: string): number {
  if (/haiku/i.test(modelId)) return 2048
  if (/opus|sonnet/i.test(modelId)) return 8192
  return 4096
}

/**
 * Anthropic providerOptions: Opus 4.x / Sonnet 4.6 开 adaptive thinking, Haiku 不开。
 * Adaptive thinking 让 Claude 自己决定何时/多深思考 (代替老 budget_tokens 模式).
 * display 默认 'omitted' —— thinking 内容不进 textStream, 用户体验是"AI 稍停后回更准确".
 * 后续可改 'summarized' 走 fullStream 把推理 UI 化.
 */
function getProviderOptionsForModel(
  modelId: string,
  provider: string
): { anthropic: { thinking: { type: 'adaptive' } } } | undefined {
  if (provider !== 'anthropic') return undefined
  if (/haiku/i.test(modelId)) return undefined
  return {
    anthropic: {
      thinking: { type: 'adaptive' }
    }
  }
}

export interface ChatChunkHandler {
  onChunk: (text: string) => void
  onDone: (usage: ChatUsage) => void
  onError: (err: ChatError) => void
  /** v0.4.0 [A] AI 调 tool 时 fullStream tool-call/tool-result/tool-error 触发 */
  onToolEvent?: (event: ToolEvent) => void
}

export interface StreamOptions {
  /** 有 toolContext → 启用 agentic tools；undefined → 纯对话不暴露 tool */
  toolContext?: ToolContext
  /** 跨会话长期记忆（pet-memory.md 内容）—— 注入 system prompt */
  memory?: string
  /** 用户档案（M5-3）—— setupCompleted=false 时 AI 走对话式 wizard */
  userProfile?: UserProfile
  /**
   * M8: 当前 pet state 名（idle/sleep/thinking/juggling/etc）—— 注入 system
   * prompt 让 AI 知道自己 currently 在干啥。**只读** —— AI 要改 state 调
   * set_pet_animation tool。
   */
  currentPetState?: string
}

/** 上层 abort 句柄 —— resetKey / 新 turn 接管时取消 in-flight stream。 */
export interface StreamHandle {
  abort(): void
}

// renderCurrentTimeSection / renderUserProfileSection 已迁到 ./system-prompts.ts
// (LOCALE-aware ZH/EN). 通过文件顶部 import 复用; 这里不再持本地实现.

export class LlmClient {
  constructor(
    private model: LanguageModel,
    private modelId: string,
    private provider: string
  ) {}

  /**
   * 同步发起流式请求 + tool 循环，立刻返回 abort 句柄。
   * 主动 abort 触发后不再走 handler.onError —— abort 是上层有意为之。
   */
  stream(
    messages: ChatMessage[],
    handler: ChatChunkHandler,
    options: StreamOptions = {}
  ): StreamHandle {
    const abortController = new AbortController()
    let aborted = false

    void (async () => {
      // **关键防御**: filter 掉空 content message 避免 Anthropic 400 "text content
      // blocks must be non-empty". 即便上游 chatHistory 漏了空 push, 这里兜底.
      const modelMessages: ModelMessage[] = messages
        .filter((m) => typeof m.content === 'string' && m.content.length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content
        }))

      // 动态拼 system prompt —— 每次 stream 都重新拼：user profile / memory 可能在
      // 上一轮 tool 调用里被更新（save_user_profile / remember）。
      // **当前时间**也每次 fresh 注入（用户跨多 turn 时间在变, system prompt cache 会
      // miss 但 time-awareness 比 cache hit 重要 1 个量级）.
      // ZH/EN 通过 system-prompts.ts 内部 LOCALE 分支 (build-time)。
      // 宪法式 persona 前置 —— 强 persona (Furina) 时把身份钉在 SYSTEM_PROMPT 最前面,
      // 让 LLM 在读"简洁温暖"默认风格之前先确认身份是 Furina, 优先级最高.
      const preamble = options.userProfile ? renderPersonaPreamble(options.userProfile) : ''
      let systemWithMemory =
        preamble + getSystemPrompt() + renderCurrentTimeSection() + renderSkillsSection()
      if (options.userProfile) {
        systemWithMemory += renderUserProfileSection(options.userProfile)
      }
      // M8: 注入当前 pet state 让 AI 知道自己 currently 在做什么动画 ——
      // 用户问"你在干啥"可以诚实答（"我刚才在杂技"），也避免 AI 在 sleep state
      // 时还说自己很 active。短一行不占太多 token，每 stream call 都刷新。
      if (options.currentPetState && options.currentPetState.trim()) {
        systemWithMemory += petStateInjection(options.currentPetState)
      }
      if (options.memory && options.memory.trim()) {
        // 跟 anthropic.ts 一样：包 <persisted_memory> 标签 + 防闭合注入
        const safeMemory = options.memory
          .trim()
          .replace(/<\s*\/\s*persisted_memory\s*>/gi, '<\\/persisted_memory>')
        systemWithMemory += memoryInjectionWrapper(safeMemory)
      }

      const tools = options.toolContext ? buildToolSetForContext(options.toolContext) : undefined

      try {
        const providerOptions = getProviderOptionsForModel(this.modelId, this.provider)
        const result = streamText({
          model: this.model,
          system: systemWithMemory,
          messages: modelMessages,
          ...(tools ? { tools } : {}),
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          maxOutputTokens: getMaxOutputTokensForModel(this.modelId),
          ...(providerOptions ? { providerOptions } : {}),
          // **v0.4.0 关键**: 默认 maxRetries=2 让 SDK 在 server 已过载时反复重发同样
          // ~18-20K token payload 3 次, 加重 server load + 把 fallback chain 推迟 7s.
          // 改 0 让单次 fail → 上层 onError → DeskPet provider fallback chain 立即切
          // 下家. graceful degradation 由我们控制, 不让 SDK 自残式 retry.
          maxRetries: 0,
          abortSignal: abortController.signal
        })

        // v0.4.0 [A]: 切 fullStream 让我们看到 tool-call / tool-result 事件 (textStream
        // 是 fullStream 的 text-only 子集, fullStream 还含 'tool-call' / 'tool-result' /
        // 'tool-error' 等). 各 case 分发: text-delta → handler.onChunk (跟之前一致),
        // tool-call → onToolEvent kind='start', tool-result → kind='end', tool-error → 'error'.
        let textChunkCount = 0
        let sawToolCall = false
        let finishedStepCount = 0
        let lastFinishReason: string | null = null
        for await (const part of result.fullStream) {
          if (aborted) return
          if (part.type === 'text-delta') {
            textChunkCount++
            handler.onChunk(part.text)
          } else if (part.type === 'tool-call') {
            sawToolCall = true
            handler.onToolEvent?.({
              kind: 'start',
              toolCallId: part.toolCallId,
              toolName: part.toolName
            })
          } else if (part.type === 'tool-result') {
            handler.onToolEvent?.({
              kind: 'end',
              toolCallId: part.toolCallId,
              toolName: part.toolName
            })
          } else if (part.type === 'tool-error') {
            handler.onToolEvent?.({
              kind: 'error',
              toolCallId: part.toolCallId,
              toolName: part.toolName
            })
          } else if (part.type === 'finish-step') {
            finishedStepCount++
            lastFinishReason = part.finishReason
          } else if (part.type === 'finish') {
            lastFinishReason = part.finishReason
          }
          // 其它 part type (text-start/text-end/start-step/error/...) 当前不 surface。
        }

        if (aborted) return
        const finishReason = String(lastFinishReason ?? (await result.finishReason))
        if (sawToolCall && finishedStepCount >= MAX_TOOL_STEPS && finishReason === 'tool-calls') {
          handler.onError({ kind: 'tool-loop-limit', maxSteps: MAX_TOOL_STEPS })
          return
        }
        // **关键修**: streamText 跑完但 0 chunk + finishReason !== 'stop'/'tool-calls' 时
        // SDK 不抛 error → 上层 handler.onDone 正常调 → 用户收到 "No output generated"
        // generic 错. 这里改 emit 显式 ChatError 让 renderer 出更可操作 hint.
        // 用户报: 切到 Opus 4.7 / Sonnet 4.6 + adaptive thinking 偶发触发 (无 text output,
        // 全在 thinking budget); 或新 doc tool 嵌套 schema 被 Anthropic strict mode 拒
        // 整 request 但 stream 走完 0 chunk.
        // S2 fix #2: textChunkCount === 0 + sawToolCall === true 时不该误判 empty-response
        // (AI 只调 tool 没 text output 是合法行为, 不应触发 fallback chain).
        if (textChunkCount === 0 && !sawToolCall) {
          if (finishReason !== 'stop' && finishReason !== 'tool-calls') {
            handler.onError({ kind: 'empty-response', finishReason })
            return
          }
        }
        // 用 totalUsage（多步 tool loop 全 step 累加），不是 .usage（只是 last step）。
        // 老 anthropic.ts 也是手撸跨 iter 累加 input/output token —— 等价行为。
        const usage = await result.totalUsage
        handler.onDone({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0
        })
      } catch (err) {
        if (aborted || abortController.signal.aborted) return
        // Debug: walk 错误链 dump 全部层 让 classifyError 失败可追
        let cur: unknown = err
        const visited = new Set<unknown>()
        for (let i = 0; i < 5 && cur && !visited.has(cur); i++) {
          visited.add(cur)
          const o = cur as {
            name?: string
            message?: string
            statusCode?: number
            responseBody?: unknown
            cause?: unknown
            lastError?: unknown
          }
          const keys = typeof o === 'object' ? Object.keys(o) : []
          console.log(
            `[llm-client] L${i}: name=${o?.name} keys=[${keys.join(',')}] statusCode=${o?.statusCode} msg=${String(o?.message ?? '').slice(0, 80)} body=${String(o?.responseBody ?? '').slice(0, 80)}`
          )
          if (typeof o === 'object') {
            cur = o.cause ?? o.lastError
          } else break
        }
        handler.onError(classifyError(err))
      }
    })()

    return {
      abort: () => {
        aborted = true
        abortController.abort()
      }
    }
  }
}

/**
 * 跨 provider 通用的 SDK error → ChatError 归类。
 *
 * AI SDK 的 HTTP-level 错误统一是 APICallError（无论 Anthropic / OpenAI / Gemini /
 * 等）：statusCode 区分；非 APICallError 看 message 关键字归类网络问题。
 */
function classifyError(err: unknown): ChatError {
  // **v0.4.0 fix**: AI SDK 把 HTTP 错误 (529 / 429) 包成 AI_NoOutputGeneratedError /
  // RetryError 等高层 wrapper, 真 APICallError 藏在 err.cause / err.lastError.
  // APICallError.isInstance 顶层 fail → instanceof 不命中. 解法: 沿 cause + lastError
  // 链 walk 收集所有候选 (顶层 + cause + lastError + cause.lastError ...), 任一层
  // 命中 statusCode / responseBody 'overloaded_error' 就归类.
  // 实测 dev log: name=AI_NoOutputGeneratedError, keys=[name,cause], cause 内含真 APICallError.

  // 收集错误链上的候选对象 (顶层 + cause chain + lastError chain), 最多 5 层防环
  type AnyErrLike = {
    statusCode?: number
    message?: string
    responseBody?: unknown
    responseHeaders?: Record<string, string | undefined>
    cause?: unknown
    lastError?: unknown
    name?: string
  }
  const chain: AnyErrLike[] = []
  const visited = new Set<unknown>()
  let cur: unknown = err
  for (let i = 0; i < 5 && cur && !visited.has(cur); i++) {
    visited.add(cur)
    if (typeof cur === 'object') {
      chain.push(cur as AnyErrLike)
      const o = cur as AnyErrLike
      // 优先 cause (Error wrap), 再 lastError (AI SDK RetryError)
      cur = o.cause ?? o.lastError
    } else break
  }

  // AI SDK isInstance 优先 (顶层是 APICallError 时类型最准)
  if (APICallError.isInstance(err)) {
    const status = err.statusCode
    if (status === 401 || status === 403) return { kind: 'invalid-api-key' }
    if (status === 429) {
      const retry = err.responseHeaders?.['retry-after']
      return { kind: 'rate-limited', retryAfterSec: retry ? Number(retry) : undefined }
    }
    // 5xx / Cloudflare gateway 错误一律归 overloaded (fallback-able):
    //   503 / 529 = upstream provider overloaded (Anthropic)
    //   502 / 504 / 524 = Cloudflare gateway timeout / bad gateway
    //     (xAI / DeepSeek / OpenAI 走 CF 时常见, 524=后端 >100s)
    //   408 = request timeout (xAI 实测能命中)
    if (
      status === 408 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 524 ||
      status === 529
    ) {
      return { kind: 'overloaded' }
    }
    // body 关键字: 余额耗尽 / 月度配额满 — 归 rate-limited 触发 fallback
    // (本 provider 短期内不可能再恢复, 跨家切才是用户期望)
    const body = String((err as { responseBody?: unknown }).responseBody ?? '')
    if (
      body.includes('insufficient_quota') ||
      body.includes('insufficient_funds') ||
      body.includes('credits_exhausted') ||
      body.includes('quota_exceeded')
    ) {
      return { kind: 'rate-limited' }
    }
    return { kind: 'api', message: err.message }
  }

  // **AI SDK NoOutputGeneratedError**: SDK 把 server 错误 (529 / 网络中断 / 等) wrap
  // 成 generic "No output generated" 错误, **cause 字段是 undefined 不可追**.
  // 真 APICallError 只在 SDK 内部 console 打印, 我们 catch 到时已 lost. 实测 dev log:
  //   L0: name=AI_NoOutputGeneratedError keys=[name,cause] statusCode=undefined
  //       msg="No output generated. Check the stream for errors."
  // 同时 stdout 单独有 APICallError [AI_APICallError]: Overloaded 但**不在 err 对象上**.
  // 策略: 归类 'empty-response' (我们已有 kind), fallback chain 同样接受这种.
  for (const c of chain) {
    if (c?.name === 'AI_NoOutputGeneratedError') {
      return { kind: 'empty-response', finishReason: 'no-output-generated' }
    }
  }

  // 链中任一层有 statusCode → 归类
  for (const c of chain) {
    const status = c?.statusCode
    if (status === 401 || status === 403) return { kind: 'invalid-api-key' }
    if (status === 429) {
      const retry = c?.responseHeaders?.['retry-after']
      return { kind: 'rate-limited', retryAfterSec: retry ? Number(retry) : undefined }
    }
    // 跟顶层 APICallError 分支同口径: 5xx + Cloudflare gateway + request-timeout 都 overloaded
    if (
      status === 408 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 524 ||
      status === 529
    ) {
      return { kind: 'overloaded' }
    }
  }

  // responseBody 字符串匹配
  //  - Anthropic 'overloaded_error' / 'rate_limit_error'
  //  - OpenAI 'insufficient_quota' (账户余额耗尽 — 短期不可恢复, fallback 到下家)
  //  - xAI 'credits_exhausted' / 'insufficient_funds'
  //  - 其他 OpenAI-compat provider 'quota_exceeded'
  for (const c of chain) {
    const body = String(c?.responseBody ?? '')
    if (body.includes('overloaded')) return { kind: 'overloaded' }
    if (body.includes('rate_limit')) return { kind: 'rate-limited' }
    if (
      body.includes('insufficient_quota') ||
      body.includes('insufficient_funds') ||
      body.includes('credits_exhausted') ||
      body.includes('quota_exceeded')
    ) {
      return { kind: 'rate-limited' }
    }
  }

  // 普通 message 兜底
  for (const c of chain) {
    const msg = (c?.message ?? '').toLowerCase()
    if (msg.includes('overloaded')) return { kind: 'overloaded' }
    if (msg.includes('rate limit') || msg.includes('rate_limit')) {
      return { kind: 'rate-limited' }
    }
  }

  if (err instanceof Error) {
    const m = err.message.toLowerCase()
    if (
      m.includes('fetch failed') ||
      m.includes('econnrefused') ||
      m.includes('etimedout') ||
      m.includes('econnreset') ||
      m.includes('enotfound')
    ) {
      return { kind: 'network' }
    }
    return { kind: 'unknown', message: err.message }
  }
  return { kind: 'unknown', message: String(err) }
}

/**
 * 粗判一段文本是不是 LLM provider 的 API key 形态。
 * 各家有不同的前缀：
 *   - Anthropic: sk-ant-...
 *   - OpenAI: sk-...
 *   - DeepSeek: sk-...
 *   - xAI: xai-...
 *   - Google / ByteDance: 无固定前缀
 * 这是 UX 防护，main 端按 selectedProvider 兜底用 provider-types 的 keyPattern 严格校验。
 */
export function looksLikeAnyApiKey(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 20 || trimmed.length > 250) return false
  // 兜底：常见 prefix
  return (
    /^sk-/.test(trimmed) ||
    /^xai-/.test(trimmed) ||
    // Google API key: AIza... 39 chars
    /^AIza[\w-]{30,}$/.test(trimmed) ||
    // ByteDance Ark API key: 没固定前缀，至少 25 字符 alphanumeric
    /^[\w-]{25,}$/.test(trimmed)
  )
}
