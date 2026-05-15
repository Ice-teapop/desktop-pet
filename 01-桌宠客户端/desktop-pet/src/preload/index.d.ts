import { ElectronAPI } from '@electron-toolkit/preload'

/** 已注册的桌宠状态 ID —— 对应 themes/<active>/theme.json 的 states 键 */
export type PetState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'moving'
  | 'organizing'
  | 'building'
  | 'multitask'
  | 'success'
  | 'error'
  | 'awaiting'
  | 'sleep'
  | 'drag'

export interface DeskPetAPI {
  windowMoveDelta(dx: number, dy: number): void
  petClick(): void
  onPetState(listener: (state: PetState) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
