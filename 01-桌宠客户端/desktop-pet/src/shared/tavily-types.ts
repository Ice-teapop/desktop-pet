/**
 * Tavily search API key IPC types（M4-D-1）。
 *
 * 跟 KeyState（Anthropic key）镜像 —— main 进程是单一事实来源，
 * 启动 + 任何变更都通过 vision:state-like push 给 renderer。
 *
 * 'configured' 不暴露真实 key（哪怕 mask 形式也不放进 IPC），UI 只需知道
 * "有 / 无"。需要重设时 user 必须重新输入。
 */
export type TavilyState =
  | { kind: 'no-key' } // 未配置
  | { kind: 'configured' } // 已加密落盘 / env var 提供
