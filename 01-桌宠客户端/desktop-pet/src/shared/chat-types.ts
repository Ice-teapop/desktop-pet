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
 * 可选的 Claude 模型 —— 这里只白名单 3 个常用档位，避免给用户太多选择 paralysis。
 * 新增模型时往 AVAILABLE_MODELS 加一行即可，托盘 submenu 自动加选项。
 */
export type ModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7'

export interface ModelInfo {
  id: ModelId
  label: string
}

export const AVAILABLE_MODELS: ReadonlyArray<ModelInfo> = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5（快 / 便宜）' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6（平衡）' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7（强 / 贵）' }
]

export const DEFAULT_MODEL: ModelId = 'claude-haiku-4-5'

export function isValidModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && AVAILABLE_MODELS.some((m) => m.id === value)
}

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
