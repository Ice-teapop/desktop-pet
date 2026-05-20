/**
 * Preload — contextBridge 暴露白名单 API 给渲染层。
 * 永远不直接暴露 ipcRenderer / fs / child_process —— 只暴露白名单方法。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ActivityState,
  ChatError as ChatErrorMsg,
  KeyState,
  ToolEvent as ToolEventMsg
} from '../shared/chat-types'
import type { VisionState } from '../shared/vision-types'
import type { ApprovalDecision, ApprovalRequest } from '../shared/approval-types'
import type { TavilyState } from '../shared/tavily-types'
import type { ChatHistoryClearedEvent } from '../shared/chat-types'
import type {
  Provider,
  ProviderKeyStates,
  SelectedModel
} from '../shared/provider-types'
import type { IpcResult, PrefsState, TrustedDirsState } from '../shared/settings-types'
import type { UserProfile } from '../shared/user-profile-types'
import type { PetMode } from '../shared/pet-mode'
import type { DropResult } from '../shared/dropped-files-types'

const api = {
  /** 渲染层接管鼠标后，把 dx/dy 增量发给主进程，由主进程移动窗口。 */
  windowMoveDelta(dx: number, dy: number): void {
    ipcRenderer.send('window:move-delta', dx, dy)
  },
  /** 订阅状态机推送的状态 ID；返回取消订阅函数。 */
  onPetState(listener: (state: string) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: string): void => listener(state)
    ipcRenderer.on('pet:state', handler)
    return () => ipcRenderer.off('pet:state', handler)
  },
  /**
   * 控制窗口是否穿透鼠标事件。
   * - ignore=true：透明区域 click 穿透到底层 app（默认）
   * - ignore=false：本窗口接收 click（鼠标移到角色实体上时关穿透）
   * 主进程始终用 { forward: true }，让 mousemove 仍 forward 到渲染层做 hit testing。
   */
  setIgnoreMouse(ignore: boolean): void {
    ipcRenderer.send('window:ignore-mouse', ignore)
  },
  /** 用户提交对话消息（M2-1 真 Anthropic Claude 流式调用）。 */
  submitChat(text: string): void {
    ipcRenderer.send('chat:submit', text)
  },
  /** 订阅 AI 流式 chunk；每个 chunk 是当次新增的文本片段。 */
  onChatChunk(listener: (text: string) => void): () => void {
    const handler = (_event: IpcRendererEvent, text: string): void => listener(text)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.off('chat:chunk', handler)
  },
  /** 订阅 AI 流式完成事件（带 usage 统计）。 */
  onChatDone(listener: (usage: { inputTokens: number; outputTokens: number }) => void): () => void {
    const handler = (
      _event: IpcRendererEvent,
      usage: { inputTokens: number; outputTokens: number }
    ): void => listener(usage)
    ipcRenderer.on('chat:done', handler)
    return () => ipcRenderer.off('chat:done', handler)
  },
  /** 订阅 LLM 错误（typed discriminated union，渲染层据 kind 显示不同 UI）。 */
  onChatError(listener: (err: ChatErrorMsg) => void): () => void {
    const handler = (_event: IpcRendererEvent, err: ChatErrorMsg): void => listener(err)
    ipcRenderer.on('chat:error', handler)
    return () => ipcRenderer.off('chat:error', handler)
  },
  /** v0.4.0 [A] 订阅 AI tool call 事件 (fullStream 'tool-call' / 'tool-result' / 'tool-error').
   *  让 renderer 加 inline msg-tool 卡 显示"AI 正在用 view_screen 看..." → 完成态绿勾. */
  onChatToolEvent(listener: (event: ToolEventMsg) => void): () => void {
    const handler = (_event: IpcRendererEvent, ev: ToolEventMsg): void => listener(ev)
    ipcRenderer.on('chat:tool-event', handler)
    return () => ipcRenderer.off('chat:tool-event', handler)
  },
  /** 通知主进程对话 UI 开/关：主进程据此切换窗口尺寸（紧凑 260 / 扩展 540）。 */
  setChatOpen(open: boolean): void {
    ipcRenderer.send('chat:set-open', open)
  },
  // —— M9-2 click reactions ——
  /** 双击/3 连击 pet → 触发 poked 反应（react-double-jump 动画） */
  petPoke(): void {
    ipcRenderer.send('pet:poke')
  },
  /** 1.5s 内 4 连击 pet → 触发 looking_around 反应（react-annoyed 动画） */
  petStartled(): void {
    ipcRenderer.send('pet:startled')
  },
  /**
   * M9-3 fix: pointerdown 时主动 wake from sleep。原本 wake 只走 drag move-delta /
   * hover (cursorWatcher 已删) / chat:submit 自动 priority，单击没 wake 入口。
   */
  petWake(): void {
    ipcRenderer.send('pet:wake')
  },
  /**
   * M9-4 eye tracking: 订阅 main 端 30Hz 推的 cursor 位置（相对 pet window 中心）。
   * 30Hz → renderer 在 rAF loop 里直接 mutate SVG group `#eyes-js`/`#body-js`/
   * `#shadow-js` 的 style.transform，不触发 React re-render。
   */
  onPetCursor(listener: (cursor: { dx: number; dy: number }) => void): () => void {
    const handler = (
      _event: IpcRendererEvent,
      cursor: { dx: number; dy: number }
    ): void => listener(cursor)
    ipcRenderer.on('pet:cursor', handler)
    return () => ipcRenderer.off('pet:cursor', handler)
  },
  // —— M9-5a Pet mode (full / mini) IPC ——
  /** 切换 pet mode（mini 藏屏幕边缘；full 正常大小） */
  setPetMode(mode: PetMode): void {
    ipcRenderer.send('pet:set-mode', mode)
  },
  /** Mount 后主动拉一次 petMode 状态（防启动 race） */
  requestPetModeState(): void {
    ipcRenderer.send('pet:request-mode-state')
  },
  /** 订阅 petMode 推送 */
  onPetMode(listener: (mode: PetMode) => void): () => void {
    const handler = (_event: IpcRendererEvent, mode: PetMode): void => listener(mode)
    ipcRenderer.on('pet:mode', handler)
    return () => ipcRenderer.off('pet:mode', handler)
  },
  /** drag 结束 → main 检测是否需要 snap to mini */
  windowDragEnd(): void {
    ipcRenderer.send('window:drag-end')
  },
  /** main 进 mini 时强制关 chat DOM —— 不走 closing 动画（窗口已缩到 100×100，动画无效） */
  onChatForceClose(listener: () => void): () => void {
    const handler = (): void => listener()
    ipcRenderer.on('pet:chat-force-close', handler)
    return () => ipcRenderer.off('pet:chat-force-close', handler)
  },
  /** vision-simplify: tray 屏幕感知 toggle 在 no-consent 时让 renderer 弹 modal */
  onVisionRequestConsentModal(listener: () => void): () => void {
    const handler = (): void => listener()
    ipcRenderer.on('vision:request-consent-modal', handler)
    return () => ipcRenderer.off('vision:request-consent-modal', handler)
  },
  /**
   * 订阅主进程通知"窗口扩展完成"事件 —— 用于渲染层等窗口动画完才 fade-in 对话 UI，
   * 避免 conversation 在 260px 窗口内右侧被裁的半渲染期。返回取消订阅函数。
   */
  onChatWindowReady(listener: () => void): () => void {
    const handler = (): void => listener()
    ipcRenderer.on('chat:window-ready', handler)
    return () => ipcRenderer.off('chat:window-ready', handler)
  },
  /**
   * 订阅 API key 状态推送 —— 主进程是单一事实来源，启动 + 任何变更都广播。
   * 渲染层据此决定走对话 (submitChat) 还是当 key 处理 (submitKey)。
   */
  onKeyState(listener: (state: KeyState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: KeyState): void => listener(state)
    ipcRenderer.on('key:state', handler)
    return () => ipcRenderer.off('key:state', handler)
  },
  /** 渲染层提交 API key —— 主进程会校验前缀 + safeStorage 加密落盘。 */
  submitKey(key: string): void {
    ipcRenderer.send('key:submit', key)
  },
  /** 渲染层请求清除已存 key —— 主进程会清盘 + 推送 key:state='missing'。 */
  resetKey(): void {
    ipcRenderer.send('key:reset')
  },
  /**
   * 渲染层 mount 后主动请求一次当前 keyState 推送 —— 防御启动 race：
   * 主进程 did-finish-load 推 'key:state' 时若 React effect 还没装 listener 会丢。
   */
  requestKeyState(): void {
    ipcRenderer.send('key:request-state')
  },
  /**
   * 订阅活动识别状态推送 —— 主进程 detector 每 5s 拿前台 App 映射出 ActivityState
   * （coding / writing / chatting / terminal / idle）。渲染层据此切对应 SVG。
   */
  onActivityState(listener: (state: ActivityState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: ActivityState): void => listener(state)
    ipcRenderer.on('pet:activity', handler)
    return () => ipcRenderer.off('pet:activity', handler)
  },

  // —— M4-A-3 视觉感知（Claude vision pivot） ——
  /** 用户点"我已了解，启用" —— 主进程把 consent + enable 一并写入 */
  acceptVisionConsentAndEnable(): void {
    ipcRenderer.send('vision:accept-consent-and-enable')
  },
  /** 启/停 vision toggle（已 consent 状态下） */
  setVisionEnabled(enabled: boolean): void {
    ipcRenderer.send('vision:set-enabled', enabled)
  },
  /** 撤销 consent —— 关功能 + 清 consent flag，下次开需要重看 modal */
  revokeVisionConsent(): void {
    ipcRenderer.send('vision:revoke-consent')
  },
  /** 渲染层 mount 后主动拉一次当前 visionState（防启动 race） */
  requestVisionState(): void {
    ipcRenderer.send('vision:request-state')
  },
  /** 订阅 vision 配置状态推送（disabled-no-consent / disabled / enabled） */
  onVisionState(listener: (state: VisionState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: VisionState): void => listener(state)
    ipcRenderer.on('vision:state', handler)
    return () => ipcRenderer.off('vision:state', handler)
  },

  // —— M4-C Approval flow（fs/cmd/defaults_write 高风险动作的用户确认）——
  /** 订阅 main 端的 approval 请求 —— 渲染层据此弹 ApprovalModal */
  onApprovalRequest(listener: (req: ApprovalRequest) => void): () => void {
    const handler = (_event: IpcRendererEvent, req: ApprovalRequest): void => listener(req)
    ipcRenderer.on('approval:request', handler)
    return () => ipcRenderer.off('approval:request', handler)
  },
  /**
   * 用户在 modal 点了某个按钮，发送决策回 main。
   * dirToTrust 仅 trust-dir-* 时需要 —— main 据此把目录加进相应 trust set。
   */
  sendApprovalResponse(id: string, decision: ApprovalDecision, dirToTrust?: string): void {
    ipcRenderer.send('approval:response', id, decision, dirToTrust)
  },
  /**
   * 通知 main: 此 id 的 modal 已真正显示给用户 → main 才开始 60s auto-deny 计时。
   * 防 race: 队列里第 N 个 request 不能从入队那一刻起计时，否则用户处理前 N-1 个
   * 期间第 N 个静默 timeout 被 auto-deny。
   */
  notifyApprovalDisplayed(id: string): void {
    ipcRenderer.send('approval:displayed', id)
  },

  // —— M4-D-1 Tavily search API key ——
  /** 提交 Tavily key，主进程 safeStorage 加密落盘 + 推送 tavily:state */
  submitTavilyKey(key: string): void {
    ipcRenderer.send('tavily:submit-key', key)
  },
  /** 清除 Tavily key，主进程 unlink + 推送 'no-key' */
  resetTavilyKey(): void {
    ipcRenderer.send('tavily:reset-key')
  },
  /** mount 后主动拉一次 state（防启动 race） */
  requestTavilyState(): void {
    ipcRenderer.send('tavily:request-state')
  },
  /** 订阅 tavily 配置状态推送（no-key / configured） */
  onTavilyState(listener: (state: TavilyState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: TavilyState): void => listener(state)
    ipcRenderer.on('tavily:state', handler)
    return () => ipcRenderer.off('tavily:state', handler)
  },

  // —— M5 设置面板 ——
  /** 打开设置窗口（任何 webContents 都能触发） */
  openSettings(): void {
    ipcRenderer.send('settings:open')
  },
  /** 拉取 Preferences 完整状态 */
  requestPrefsState(): void {
    ipcRenderer.send('prefs:request-state')
  },
  /** 订阅 Preferences 推送（设置面板 + 主窗口都收） */
  onPrefsState(listener: (state: PrefsState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: PrefsState): void => listener(state)
    ipcRenderer.on('prefs:state', handler)
    return () => ipcRenderer.off('prefs:state', handler)
  },
  // PR-5: 删 setModel + prefs:set-model — Anthropic-only legacy, renderer 零 caller,
  // 改 model 全部走 setSelectedModel (multi-provider)。
  // —— M7-4 multi-provider key + selected-model API ——
  /** 提交某 provider 的 key（任 provider）。主进程 safeStorage 加密 + 推 states */
  submitProviderKey(provider: Provider, key: string): void {
    ipcRenderer.send('provider-key:submit', provider, key)
  },
  /** 清除某 provider 的 key + 推 states */
  resetProviderKey(provider: Provider): void {
    ipcRenderer.send('provider-key:reset', provider)
  },
  /** mount 后主动拉一次所有 provider 的配置状态（防启动 race） */
  requestProviderKeyStates(): void {
    ipcRenderer.send('provider-key:request-states')
  },
  /** 订阅所有 provider 的 has-key boolean map 推送（Settings UI 渲染状态灯用） */
  onProviderKeyStates(listener: (states: ProviderKeyStates) => void): () => void {
    const handler = (_event: IpcRendererEvent, states: ProviderKeyStates): void =>
      listener(states)
    ipcRenderer.on('provider-key:states', handler)
    return () => ipcRenderer.off('provider-key:states', handler)
  },
  /** 切换当前选中的 provider/model 组合 */
  setSelectedModel(sel: SelectedModel): void {
    ipcRenderer.send('selected-model:set', sel)
  },
  /** mount 后主动拉一次当前 SelectedModel（防启动 race） */
  requestSelectedModelState(): void {
    ipcRenderer.send('selected-model:request-state')
  },
  /** 订阅 SelectedModel 推送（切换 / 启动时主进程推） */
  onSelectedModelState(listener: (sel: SelectedModel) => void): () => void {
    const handler = (_event: IpcRendererEvent, sel: SelectedModel): void => listener(sel)
    ipcRenderer.on('selected-model:state', handler)
    return () => ipcRenderer.off('selected-model:state', handler)
  },
  setFollowFrontApp(value: boolean): void {
    ipcRenderer.send('prefs:set-follow-front-app', value)
  },
  setUseFastPath(value: boolean): void {
    ipcRenderer.send('prefs:set-use-fast-path', value)
  },
  // —— audit log ——
  revealAuditLogInFinder(): void {
    ipcRenderer.send('audit:reveal-in-finder')
  },
  clearAuditLog(): Promise<IpcResult> {
    return ipcRenderer.invoke('audit:clear') as Promise<IpcResult>
  },
  // —— trusted dirs ——
  requestTrustedDirsState(): void {
    ipcRenderer.send('trusted-dirs:request-state')
  },
  onTrustedDirsState(listener: (state: TrustedDirsState) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: TrustedDirsState): void =>
      listener(state)
    ipcRenderer.on('trusted-dirs:state', handler)
    return () => ipcRenderer.off('trusted-dirs:state', handler)
  },
  revokeTrustedDirPersistent(dir: string): Promise<IpcResult> {
    return ipcRenderer.invoke('trusted-dirs:revoke-persistent', dir) as Promise<IpcResult>
  },
  revokeAllSessionTrustedDirs(): void {
    ipcRenderer.send('trusted-dirs:revoke-all-session')
  },
  // —— M5-2 跨会话记忆 ——
  readMemory(): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
    return ipcRenderer.invoke('memory:read') as Promise<
      { ok: true; content: string } | { ok: false; error: string }
    >
  },
  clearMemory(): Promise<IpcResult> {
    return ipcRenderer.invoke('memory:clear') as Promise<IpcResult>
  },
  saveMemory(content: string): Promise<IpcResult> {
    return ipcRenderer.invoke('memory:save', content) as Promise<IpcResult>
  },
  revealMemoryInFinder(): void {
    ipcRenderer.send('memory:reveal-in-finder')
  },
  clearChatHistory(): Promise<IpcResult> {
    return ipcRenderer.invoke('chat-history:clear') as Promise<IpcResult>
  },
  revealChatHistoryInFinder(): void {
    ipcRenderer.send('chat-history:reveal-in-finder')
  },
  /** 主进程清 chatHistory 后广播此事件 (含 reason 让 renderer 决定是否 surface 气泡) */
  onChatHistoryCleared(
    listener: (event: ChatHistoryClearedEvent) => void
  ): () => void {
    const handler = (_e: IpcRendererEvent, ev: ChatHistoryClearedEvent): void =>
      listener(ev)
    ipcRenderer.on('chat:history-cleared', handler)
    return () => ipcRenderer.off('chat:history-cleared', handler)
  },
  // —— M5-3 用户档案 ——
  requestUserProfileState(): void {
    ipcRenderer.send('user-profile:request-state')
  },
  onUserProfileState(listener: (profile: UserProfile) => void): () => void {
    const handler = (_e: IpcRendererEvent, p: UserProfile): void => listener(p)
    ipcRenderer.on('user-profile:state', handler)
    return () => ipcRenderer.off('user-profile:state', handler)
  },
  saveUserProfile(profile: Partial<UserProfile>): Promise<IpcResult> {
    return ipcRenderer.invoke('user-profile:save', profile) as Promise<IpcResult>
  },
  resetUserProfileSetup(): Promise<IpcResult> {
    return ipcRenderer.invoke('user-profile:reset-setup') as Promise<IpcResult>
  },
  revealUserProfileInFinder(): void {
    ipcRenderer.send('user-profile:reveal-in-finder')
  },
  // v0.4.0 改动 2 [D] 拖文件 — 返回 DropResult, renderer 自己拼 submitChat
  dropFiles(paths: string[]): Promise<DropResult> {
    return ipcRenderer.invoke('chat:drop-files', paths) as Promise<DropResult>
  },
  // Electron 32+ 移除了 File.path; 必须走 webUtils.getPathForFile 拿到绝对路径.
  // renderer 直接 import webUtils 会被 contextIsolation 拦; 通过 preload bridge 出来.
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  // v0.4.3+ DnD 回退: macOS 透明 NSPanel 不接 HTML5 drop, 改用 menu bar tray
  // 图标作 drop target. main 在 tray.on('drop-files') 接到路径后推到这里.
  onTrayDropFiles(listener: (paths: string[]) => void): () => void {
    const handler = (_e: IpcRendererEvent, paths: string[]): void => listener(paths)
    ipcRenderer.on('tray:drop-files', handler)
    return () => ipcRenderer.off('tray:drop-files', handler)
  },
  // v0.4.3+ chat 输入栏 "📂 导入" 按钮触发的 IPC — main 弹系统文件选择器,
  // 选完路径走 tray:drop-files channel 推回 (跟 tray 拖文件同一份后续).
  openImportFilesDialog(): void {
    ipcRenderer.send('chat:import-files-dialog')
  },
  // v0.4.5+ Batch 1: mini 模式 user 鼠标靠近 / 离开时主进程推 peek 状态,
  // renderer 切 mini-peek.gif / 回 mini-idle.gif.
  onMiniPeek(listener: (peeking: boolean) => void): () => void {
    const handler = (_e: IpcRendererEvent, peeking: boolean): void => listener(peeking)
    ipcRenderer.on('pet:mini-peek', handler)
    return () => ipcRenderer.off('pet:mini-peek', handler)
  },
  // v0.4.0 改动 4 [B] listModels — 触发 main 拉 + push, listener 收 per-provider 列表
  requestAvailableModels(): void {
    ipcRenderer.send('available-models:request')
  },
  onAvailableModels(
    listener: (modelsByProvider: Record<string, string[]>) => void
  ): () => void {
    const handler = (_e: IpcRendererEvent, r: Record<string, string[]>): void => listener(r)
    ipcRenderer.on('available-models:state', handler)
    return () => ipcRenderer.off('available-models:state', handler)
  },
  // 改动 5 [#5] provider 余额查询 — 当前仅 DeepSeek 真查, 其他返 'unsupported'.
  fetchProviderBalance(provider: Provider): Promise<unknown> {
    return ipcRenderer.invoke('provider-balance:request', provider)
  },
  // 改动 8 [#7] 更新检查 — main 启动 30s 后自动跑一次, tray 也有手动入口.
  // upToDate=true → renderer 显"已是最新"; 否则有 version + htmlUrl → 显"v0.x.y, 去更新"
  onUpdateAvailable(
    listener: (event: { version: string; htmlUrl: string; upToDate?: boolean }) => void
  ): () => void {
    const handler = (
      _e: IpcRendererEvent,
      payload: { version: string; htmlUrl: string; upToDate?: boolean }
    ): void => listener(payload)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.off('update:available', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
