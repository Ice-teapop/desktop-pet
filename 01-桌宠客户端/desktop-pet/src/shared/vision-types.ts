/**
 * Vision IPC + 内部类型（M4-A-3 agentic）—— pivot 到 tool use 后大幅简化。
 *
 * 只保留 VisionState 让渲染层 toggle 知道当前是允许/禁止 AI 调 view_screen。
 * 不再有 VisionProgress（无感纪律：UI 不显示截屏进度）。
 * 不再有 VisionFailReason（截图失败时 AI 通过 tool_result 看到并自己讲给用户）。
 */

/**
 * vision 配置三态（主→渲推送 + 渲拉取）：
 *  - disabled-no-consent：用户没勾过隐私 modal，不可启用
 *  - disabled：consent 给了但 toggle 关 —— AI 看不到 view_screen tool
 *  - enabled：toggle 开 —— AI 看到 view_screen tool，自行决定何时调用
 */
export type VisionState =
  | { kind: 'disabled-no-consent' }
  | { kind: 'disabled' }
  | { kind: 'enabled' }
