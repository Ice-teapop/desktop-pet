/**
 * Approval flow IPC types（M4-C）—— 主进程 ↔ 渲染层之间的 per-action 审批通信。
 *
 * 流程：
 *   1. AI 调高风险 tool（fs/cmd/defaults_write）
 *   2. main 端 tools.ts 通过 approval.ts 发 'approval:request' 给 renderer
 *      并 await Promise<ApprovalDecision>
 *   3. renderer 显示 ApprovalModal，用户点 4 个按钮之一
 *   4. renderer 发 'approval:response' { id, decision }
 *   5. main 端 resolve 那个 Promise，继续 tool 执行 / 返回 denied
 */

/** 弹给用户看的请求详情（不含 token、不含敏感本体内容预览）。 */
export interface ApprovalRequest {
  /** uuid，main 端生成；用于 response 路由回 promise resolver */
  id: string
  /** 工具名（read_file / list_directory / run_command 等） */
  tool: string
  /** 人类可读 1 行 summary（modal 顶部显示） */
  summary: string
  /** 完整路径 —— 用于"信任此目录"按钮的目录推导（单 path 场景） */
  path?: string
  /** 批量路径列表 —— delete_file 等支持批量的 tool 使用；与 path 互斥。
   *  paths.length > 1 时 modal 必须**禁用** trust-dir-* 按钮（跨多个父目录的
   *  persistent trust 用户无法 informed-consent，scope 爆炸） */
  paths?: string[]
  /** 完整 shell 命令 —— 用于 modal 详情展示 */
  command?: string
  /** 写入操作的内容预览（最多 200 字） */
  contentPreview?: string
}

/** 用户决策。'trust-dir-*' 仅在请求带 path 时可选。 */
export type ApprovalDecision =
  | 'deny'
  | 'allow-once'
  | 'trust-dir-session'
  | 'trust-dir-permanent'
