/**
 * Preload — contextBridge 暴露白名单 API 给渲染层。
 * 永远不直接暴露 ipcRenderer / fs / child_process —— 只暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  /** 渲染层接管鼠标后，把 dx/dy 增量发给主进程，由主进程移动窗口。 */
  windowMoveDelta(dx: number, dy: number): void {
    ipcRenderer.send('window:move-delta', dx, dy)
  },
  /** 通知主进程：用户单击了桌宠。 */
  petClick(): void {
    ipcRenderer.send('pet:event:click')
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
  /** 用户提交对话消息（M1-8 主进程模拟 echo；M2 替换为真 LLM 流式调用）。 */
  submitChat(text: string): void {
    ipcRenderer.send('chat:submit', text)
  },
  /** 订阅 AI 回复推送；返回取消订阅函数。 */
  onChatReply(listener: (text: string) => void): () => void {
    const handler = (_event: IpcRendererEvent, text: string): void => listener(text)
    ipcRenderer.on('chat:reply', handler)
    return () => ipcRenderer.off('chat:reply', handler)
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
