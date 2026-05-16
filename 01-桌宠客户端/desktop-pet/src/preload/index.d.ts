import { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '../shared/pet-state'
import type { ActivityState, ChatError, ChatUsage, KeyState } from '../shared/chat-types'
import type { VisionProgress, VisionState } from '../shared/vision-types'

export type { PetState, ActivityState, ChatError, ChatUsage, KeyState }
export type { VisionProgress, VisionState }

export interface DeskPetAPI {
  windowMoveDelta(dx: number, dy: number): void
  onPetState(listener: (state: PetState) => void): () => void
  setIgnoreMouse(ignore: boolean): void
  submitChat(text: string): void
  onChatChunk(listener: (text: string) => void): () => void
  onChatDone(listener: (usage: ChatUsage) => void): () => void
  onChatError(listener: (err: ChatError) => void): () => void
  setChatOpen(open: boolean): void
  onChatWindowReady(listener: () => void): () => void
  onKeyState(listener: (state: KeyState) => void): () => void
  submitKey(key: string): void
  resetKey(): void
  requestKeyState(): void
  onActivityState(listener: (state: ActivityState) => void): () => void
  // M4-A-2 视觉感知
  submitVisionToken(token: string): void
  setVisionEnabled(enabled: boolean): void
  clearVisionToken(): void
  requestVisionState(): void
  onVisionState(listener: (state: VisionState) => void): () => void
  onVisionProgress(listener: (p: VisionProgress) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
