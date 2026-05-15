/**
 * Preload — 通过 contextBridge 给渲染层暴露受限的主进程能力。
 * 永远不直接暴露 ipcRenderer / fs / child_process —— 只暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 暴露给渲染层的项目自有 API（白名单）
const api = {
  /** 渲染层接管鼠标后，把 dx/dy 增量发给主进程，由主进程移动窗口。 */
  windowMoveDelta(dx: number, dy: number): void {
    ipcRenderer.send('window:move-delta', dx, dy)
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
