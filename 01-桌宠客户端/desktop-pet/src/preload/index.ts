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
