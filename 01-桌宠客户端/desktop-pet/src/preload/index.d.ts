import { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '../shared/pet-state'
import type { ActivityState, ChatError, ChatUsage, KeyState } from '../shared/chat-types'
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

export type { PetState, ActivityState, ChatError, ChatUsage, KeyState }
export type { VisionState }
export type { ApprovalDecision, ApprovalRequest }
export type { TavilyState }
export type { ModelId, IpcResult, PrefsState, TrustedDirsState }
export type { Provider, ProviderKeyStates, SelectedModel }
export type { UserProfile }

export interface DeskPetAPI {
  windowMoveDelta(dx: number, dy: number): void
  onPetState(listener: (state: PetState) => void): () => void
  setIgnoreMouse(ignore: boolean): void
  submitChat(text: string): void
  onChatChunk(listener: (text: string) => void): () => void
  onChatDone(listener: (usage: ChatUsage) => void): () => void
  onChatError(listener: (err: ChatError) => void): () => void
  setChatOpen(open: boolean): void
  // M9-2 click reactions + M9-3 wake hook + M9-4 eye tracking
  petPoke(): void
  petStartled(): void
  petWake(): void
  onPetCursor(listener: (cursor: { dx: number; dy: number }) => void): () => void
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
  // M5 settings panel
  openSettings(): void
  requestPrefsState(): void
  onPrefsState(listener: (state: PrefsState) => void): () => void
  setModel(modelId: ModelId): void
  // M7-4 multi-provider key + selected-model
  submitProviderKey(provider: Provider, key: string): void
  resetProviderKey(provider: Provider): void
  requestProviderKeyStates(): void
  onProviderKeyStates(listener: (states: ProviderKeyStates) => void): () => void
  setSelectedModel(sel: SelectedModel): void
  requestSelectedModelState(): void
  onSelectedModelState(listener: (sel: SelectedModel) => void): () => void
  setFollowFrontApp(value: boolean): void
  setUseFastPath(value: boolean): void
  revealAuditLogInFinder(): void
  clearAuditLog(): Promise<IpcResult>
  requestTrustedDirsState(): void
  onTrustedDirsState(listener: (state: TrustedDirsState) => void): () => void
  revokeTrustedDirPersistent(dir: string): Promise<IpcResult>
  revokeAllSessionTrustedDirs(): void
  // M5-2 跨会话记忆
  readMemory(): Promise<{ ok: true; content: string } | { ok: false; error: string }>
  clearMemory(): Promise<IpcResult>
  saveMemory(content: string): Promise<IpcResult>
  revealMemoryInFinder(): void
  clearChatHistory(): Promise<IpcResult>
  revealChatHistoryInFinder(): void
  onChatHistoryCleared(listener: () => void): () => void
  // M5-3 用户档案
  requestUserProfileState(): void
  onUserProfileState(listener: (profile: UserProfile) => void): () => void
  saveUserProfile(profile: Partial<UserProfile>): Promise<IpcResult>
  resetUserProfileSetup(): Promise<IpcResult>
  revealUserProfileInFinder(): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
