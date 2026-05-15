import { ElectronAPI } from '@electron-toolkit/preload'

export interface DeskPetAPI {
  /** 渲染层接管鼠标后，把 dx/dy 增量发给主进程，由主进程移动窗口。 */
  windowMoveDelta(dx: number, dy: number): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
