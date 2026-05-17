/**
 * Preload — contextBridge 暴露白名单 API 给渲染层。
 * 永远不直接暴露 ipcRenderer / fs / child_process —— 只暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ActivityState, ChatError as ChatErrorMsg, KeyState } from '../shared/chat-types'
import type { VisionState } from '../shared/vision-types'
import type { ApprovalDecision, ApprovalRequest } from '../shared/approval-types'
import type { TavilyState } from '../shared/tavily-types'
import type { ModelId } from '../shared/chat-types'
import type {
  Provider,
  ProviderKeyStates,
  SelectedModel
} from '../shared/provider-types'
import type { IpcResult, PrefsState, TrustedDirsState } from '../shared/settings-types'
import type { UserProfile } from '../shared/user-profile-types'

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
  setModel(modelId: ModelId): void {
    ipcRenderer.send('prefs:set-model', modelId)
  },
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
  /** 主进程在 user 触发 clearChatHistory 后会广播此事件 —— App.tsx 用来清消息 UI */
  onChatHistoryCleared(listener: () => void): () => void {
    const handler = (): void => listener()
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
