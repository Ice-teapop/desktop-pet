/**
 * Preload — contextBridge 暴露白名单 API 给渲染层。
 * 永远不直接暴露 ipcRenderer / fs / child_process —— 只暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ActivityState, ChatError as ChatErrorMsg, KeyState } from '../shared/chat-types'
import type { VisionState } from '../shared/vision-types'

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
