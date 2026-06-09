import { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '../shared/pet-state'
import type { ActivityState, ChatError, ChatUsage, KeyState, ToolEvent } from '../shared/chat-types'
import type { VisionState } from '../shared/vision-types'
import type { ApprovalDecision, ApprovalRequest } from '../shared/approval-types'
import type { TavilyState } from '../shared/tavily-types'
import type { ModelId, ChatHistoryClearedEvent } from '../shared/chat-types'
import type { Provider, ProviderKeyStates, SelectedModel } from '../shared/provider-types'
import type { IpcResult, PrefsState, TrustedDirsState } from '../shared/settings-types'
import type { UserProfile } from '../shared/user-profile-types'
import type { PetMode } from '../shared/pet-mode'
import type { DropResult } from '../shared/dropped-files-types'

export type { PetState, ActivityState, ChatError, ChatUsage, KeyState, ToolEvent }
export type { VisionState }
export type { ApprovalDecision, ApprovalRequest }
export type { TavilyState }
export type { ModelId, IpcResult, PrefsState, TrustedDirsState }
export type { Provider, ProviderKeyStates, SelectedModel }
export type { UserProfile }
export type { PetMode }

export interface DeskPetAPI {
  windowMoveDelta(dx: number, dy: number): void
  onPetState(listener: (state: PetState) => void): () => void
  setIgnoreMouse(ignore: boolean): void
  submitChat(text: string): void
  onChatChunk(listener: (text: string) => void): () => void
  onChatDone(listener: (usage: ChatUsage) => void): () => void
  onChatError(listener: (err: ChatError) => void): () => void
  onChatToolEvent(listener: (event: ToolEvent) => void): () => void
  setChatOpen(open: boolean): void
  // M9-2 click reactions + M9-3 wake hook + M9-4 cursor follow + M9-5 mini mode
  petPoke(): void
  petStartled(): void
  petWake(): void
  onPetCursor(listener: (cursor: { dx: number; dy: number }) => void): () => void
  setPetMode(mode: PetMode): void
  requestPetModeState(): void
  onPetMode(listener: (mode: PetMode) => void): () => void
  windowDragEnd(): void
  onChatForceClose(listener: () => void): () => void
  onVisionRequestConsentModal(listener: () => void): () => void
  onChatWindowReady(listener: () => void): () => void
  onKeyState(listener: (state: KeyState) => void): () => void
  submitKey(key: string): void
  resetKey(): void
  requestKeyState(): void
  onActivityState(listener: (state: ActivityState) => void): () => void
  requestActivityState(): void
  // M4-A-4 视觉感知（agentic tool use）
  acceptVisionConsentAndEnable(): void
  setVisionEnabled(enabled: boolean): void
  revokeVisionConsent(): void
  requestVisionState(): void
  onVisionState(listener: (state: VisionState) => void): () => void
  // M4-C Approval flow
  onApprovalRequest(listener: (req: ApprovalRequest) => void): () => void
  onApprovalResolved(listener: (id: string) => void): () => void
  sendApprovalResponse(id: string, decision: ApprovalDecision, dirToTrust?: string): void
  notifyApprovalDisplayed(id: string): void
  // M4-D-1 Tavily search API key
  submitTavilyKey(key: string): void
  resetTavilyKey(): void
  requestTavilyState(): void
  onTavilyState(listener: (state: TavilyState) => void): () => void
  // M5 settings panel
  openSettings(): void
  requestPrefsState(): void
  onPrefsState(listener: (state: PrefsState) => void): () => void
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
  onChatHistoryCleared(listener: (event: ChatHistoryClearedEvent) => void): () => void
  // M5-3 用户档案
  requestUserProfileState(): void
  onUserProfileState(listener: (profile: UserProfile) => void): () => void
  saveUserProfile(profile: Partial<UserProfile>): Promise<IpcResult>
  resetUserProfileSetup(): Promise<IpcResult>
  revealUserProfileInFinder(): void
  // v0.4.0 改动 2 [D] 拖文件 — 给 AI 喂上下文
  dropFiles(paths: string[]): Promise<DropResult>
  // Electron 32+ File.path 移除替代 — renderer 拿 dataTransfer.files[i] 后用此查路径
  getPathForFile(file: File): string
  // v0.4.3+ DnD 回退: 拖文件到 menu bar tray 图标, main 转发绝对路径数组到这里
  onTrayDropFiles(listener: (paths: string[]) => void): () => void
  // v0.4.3+ chat 输入栏 "📂 导入" 按钮 — 主进程弹系统文件选择器, 选完走 tray:drop-files
  openImportFilesDialog(): void
  // v0.4.5+ Batch 1: mini-mode hover-peek 状态推送 — true 切 mini-peek.gif, false 回 mini-idle.gif
  onMiniPeek(listener: (peeking: boolean) => void): () => void
  // v0.4.5+ Batch 3 后续: 托盘 🧙 巫师模式 toggle (非持久, 重启 = off)
  onManualWizardMode(listener: (active: boolean) => void): () => void
  requestManualWizardMode(): void
  // v0.4.5+ Batch 2: main 用 shell.openExternal 打开 URL (only http/https allowlisted)
  openExternal(url: string): Promise<{ ok: true } | { ok: false; error: string }>

  // v0.4.0 改动 4 [B] 动态 listModels
  requestAvailableModels(): void
  onAvailableModels(listener: (modelsByProvider: Record<string, string[]>) => void): () => void
  // 改动 5 [#5] provider 余额查询
  fetchProviderBalance(provider: Provider): Promise<ProviderBalance>
  // 改动 8 [#7] 更新检查 — main 启动 30s 后自动 + tray 手动. upToDate=true → "已是最新".
  onUpdateAvailable(
    listener: (event: { version: string; htmlUrl: string; upToDate?: boolean }) => void
  ): () => void
}

export type { ProviderBalance } from '../shared/provider-balance-types'

export type {
  DropResult,
  AcceptedDroppedFile,
  RejectedDroppedFile
} from '../shared/dropped-files-types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskPetAPI
  }
}
