/**
 * 设置面板 IPC types（M5）。
 *
 * 主进程是单一事实来源；preferences.json 跟内存状态保持同步；这两个 push state
 * 让 renderer 反应迁移过的内存值（而不是每次都读盘）。
 *
 * PR-4: 删 `modelId` 字段 — model 走专用 `selected-model:state` channel,
 * prefs:state 只管"非 model 偏好" (followFrontApp / useFastPath / vision*).
 * 旧版双 channel 推 model state 是症状 2 (Settings vs pill 不一致) 可能源头。
 */

/** Preferences 完整快照 —— 主进程 prefs:state 推送给所有窗口 */
export interface PrefsState {
  followFrontApp: boolean
  useFastPath: boolean
  visionEnabled: boolean
  visionConsented: boolean
}

/** Trusted dirs 快照（M4-C 用户审批过的目录） */
export interface TrustedDirsState {
  session: string[] // 本会话 trust（main 退出即丢）
  persistent: string[] // 落盘 trust（trusted-dirs.json）
}

/** audit:clear / trusted-dirs:revoke-persistent 的统一返回 */
export type IpcResult = { ok: true } | { ok: false; error: string }
