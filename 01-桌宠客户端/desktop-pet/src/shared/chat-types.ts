/**
 * 对话相关类型 —— main / preload / renderer 共用单一源。
 *
 * ChatError 是结构化的错误归类（不是原始 Error message），让渲染层根据 kind
 * 渲染不同 UI（'no-api-key' 引导设置；'rate-limited' 显示倒计时；等）。
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ChatError =
  | { kind: 'no-api-key' }
  | { kind: 'invalid-api-key' }
  | { kind: 'rate-limited'; retryAfterSec?: number }
  | { kind: 'overloaded' }
  | { kind: 'network' }
  | { kind: 'api'; message: string }
  | { kind: 'unknown'; message: string }
  // safeStorage 不可用（Linux 无 keyring）—— 这次内存里能用但下次启动会丢
  | { kind: 'key-not-persisted' }
  // 提交的 key 不符合 sk-ant-[\w-]{20,200} 格式（renderer 跟 main 校验不一致时 main 兜底）
  | { kind: 'key-format-invalid' }

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * API key 持有状态：
 *  - 'missing' 没 key（首启 / 用户主动清除 / Anthropic 拒了上次的 key）
 *  - 'ready'   有 key 可调 LLM
 *
 * 渲染层据此决定：用 chat:submit 走对话 / 用 key:submit 当 key 处理；
 * 主进程是单一事实来源，启动 + 任何变更都通过 'key:state' 推送给渲染层。
 */
export type KeyState = 'missing' | 'ready'

/**
 * Anthropic Claude 单 provider 时代的 model 类型 + 注册表 + 校验。
 *
 * @deprecated M7-3 multi-provider migration: 新代码统一用 `provider-types.ts`
 * 的 `SelectedModel`（含 `Provider` 维度）/ `AVAILABLE_MODELS`（含 6 个 provider 的
 * model entries 含 vision/tools capability flag）/ `DEFAULT_SELECTED_MODEL` /
 * `isValidSelectedModel`。
 *
 * 仍保留下方的 `ModelId` 等：
 *  1. `preferences.ts` 的 legacy `Preferences.modelId` 字段 forward-compat
 *     migration（读老 preferences.json）
 *  2. `main/index.ts` 的 legacy `currentModel: ModelId` mirror（跟新
 *     `currentSelectedModel: SelectedModel` 并存到 wave 4 整体切换）
 *  3. `activity-classifier.ts` 用 `isValidActivityState`（同文件别的 type）
 *
 * 桥接重导：本文件下方 re-export `provider-types.ts` 的新类型，方便 consumer 用一个
 * import 拿到完整面（少改 import 路径）。
 */

/** @deprecated 用 `provider-types.ts` 的 `SelectedModel.modelId` 替代 */
export type ModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7'

/** @deprecated 用 `provider-types.ts` 的 `ModelEntry` 替代（含 provider/vision/tools flag） */
export interface ModelInfo {
  id: ModelId
  label: string
}

/** @deprecated 用 `provider-types.ts` 的 `AVAILABLE_MODELS`（6 provider 的 ModelEntry[]）替代 */
export const AVAILABLE_MODELS: ReadonlyArray<ModelInfo> = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5（快 / 便宜）' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6（平衡）' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7（强 / 贵）' }
]

/** @deprecated 用 `provider-types.ts` 的 `DEFAULT_SELECTED_MODEL` 替代 */
export const DEFAULT_MODEL: ModelId = 'claude-haiku-4-5'

/** @deprecated 用 `provider-types.ts` 的 `isValidSelectedModel` 替代 */
export function isValidModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && AVAILABLE_MODELS.some((m) => m.id === value)
}

// —— M7-3 bridge re-exports：让旧 consumer 改 import 时不必同时改路径 ——
// 新代码推荐直接从 `provider-types.ts` import；这些 re-export 是 transitional 便利。
export {
  PROVIDERS,
  PROVIDER_ORDER,
  AVAILABLE_MODELS as AVAILABLE_MODELS_V2,
  DEFAULT_SELECTED_MODEL,
  isValidProvider,
  isValidSelectedModel,
  modelsForProvider,
  findModel,
  defaultModelForProvider,
  type Provider,
  type ProviderInfo,
  type ModelEntry,
  type SelectedModel
} from './provider-types'

/**
 * 活动状态 —— 主进程 ActiveAppPoller 用 osascript 拿 macOS 前台 app 名后映射出来。
 * 跟 PetState 是独立 dimension：PetState 反映 LLM 流（idle/thinking/success/error），
 * ActivityState 反映用户当前在干啥（focus type）。
 *
 * 渲染层组合策略：
 *  - stateMachine=idle + activity≠'idle' → 显示「专注」SVG (working-thinking)
 *  - stateMachine=idle + activity='idle' → 玩 idle-follow / idle-living variant 切换
 *  - stateMachine≠idle → 由 PetState 直接决定 SVG（LLM 流优先于环境感知）
 *
 * 这层信号未来还能喂给 LLM system prompt（写代码时回答更技术、写文档时更结构化）。
 */
export type ActivityState = 'coding' | 'writing' | 'chatting' | 'terminal' | 'idle'

export interface ActivityInfo {
  state: ActivityState
  emoji: string
  label: string
}

export const ACTIVITY_INFO: Readonly<Record<ActivityState, ActivityInfo>> = {
  coding: { state: 'coding', emoji: '💻', label: '写代码' },
  writing: { state: 'writing', emoji: '📝', label: '写文档' },
  chatting: { state: 'chatting', emoji: '💬', label: '沟通' },
  terminal: { state: 'terminal', emoji: '🖥️', label: '终端' },
  idle: { state: 'idle', emoji: '☁️', label: '闲着' }
}

export function isValidActivityState(value: unknown): value is ActivityState {
  return (
    typeof value === 'string' &&
    (value === 'coding' ||
      value === 'writing' ||
      value === 'chatting' ||
      value === 'terminal' ||
      value === 'idle')
  )
}
