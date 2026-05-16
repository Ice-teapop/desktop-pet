import { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '../shared/pet-state'
import type { ActivityState, ChatError, ChatUsage, KeyState } from '../shared/chat-types'
import type { VisionState } from '../shared/vision-types'
import type { ApprovalDecision, ApprovalRequest } from '../shared/approval-types'
import type { TavilyState } from '../shared/tavily-types'

export type { PetState, ActivityState, ChatError, ChatUsage, KeyState }
export type { VisionState }
export type { ApprovalDecision, ApprovalRequest }
export type { TavilyState }

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
  // M4-A-4 视觉感知（agentic tool use）
  acceptVisionConsentAndEnable(): void
  setVisionEnabled(enabled: boolean): void
  revokeVisionConsent(): void
  requestVisionState(): void
  onVisionState(listener: (state: VisionState) => void): () => void
  // M4-C Approval flow
  onApprovalRequest(listener: (req: ApprovalRequest) => void): () => void
  sendApprovalResponse(id: string, decision: ApprovalDecision, dirToTrust?: string): void
  // M4-D-1 Tavily search API key
  submitTavilyKey(key: string): void
  resetTavilyKey(): void
  requestTavilyState(): void
  onTavilyState(listener: (state: TavilyState) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
