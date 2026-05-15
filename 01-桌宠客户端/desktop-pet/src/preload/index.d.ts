import { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '../shared/pet-state'

export type { PetState }

export interface DeskPetAPI {
  windowMoveDelta(dx: number, dy: number): void
  petClick(): void
  onPetState(listener: (state: PetState) => void): () => void
  setIgnoreMouse(ignore: boolean): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
