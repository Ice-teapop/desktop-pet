/**
 * 用户偏好持久化（M3-2）。
 *
 * M7-3 schema 演进：原 `modelId: ModelId`（写死 Claude 3 个 id）→ 新增
 * `selectedModel: SelectedModel`（{ provider, modelId } 多 provider 表达）。
 * 老 `modelId` 字段保留兼容：load 时若文件无 selectedModel 但有 modelId，从 modelId
 * 推断 provider=anthropic 完成 forward-compat 迁移；save 时两个字段一起写。
 *
 * 不用 safeStorage 加密 —— preference 不敏感（模型 ID 是公开信息）。
 * 写到 userData/preferences.json（跟 credentials.bin 同目录但语义独立）。
 *
 * 读：找不到文件 / 解析失败 / 字段缺失 → 返回 default（DEFAULT_SELECTED_MODEL）让 app 能起。
 * 写：JSON.stringify + chmod 600（不严格必要但跟 credentials 一致风格）。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_MODEL, isValidModelId, type ModelId } from '../../shared/chat-types'
import {
  DEFAULT_SELECTED_MODEL,
  isValidSelectedModel,
  type SelectedModel
} from '../../shared/provider-types'
import { DEFAULT_PET_MODE, isPetMode, type PetMode } from '../../shared/pet-mode'

const FILE_NAME = 'preferences.json'

export interface Preferences {
  /**
   * @deprecated M7-3 前的单 Anthropic 时代字段，仅保留供 forward-compat
   * migration 读老文件。新代码统一用 selectedModel。
   */
  modelId: ModelId
  /** M7-3：多 provider 选 model。是新的主字段。 */
  selectedModel: SelectedModel
  /** 跟随前台 App 自动识别活动（写代码 / 写文档...）—— 默认开，用户托盘可关 */
  followFrontApp: boolean
  /** fast-path bundleID regex 白名单：默认开（常见 app 1ms 命中），关 = 严格 LLM 识别 */
  useFastPath: boolean
  /** 视觉感知：每次发消息时附带屏幕截图给 vision-capable model（M4-A-3）—— 默认关 */
  visionEnabled: boolean
  /** 用户是否同意过隐私 modal（截图发 LLM provider）—— 一次性，consent 后才能 enable */
  visionConsented: boolean
  /** M9-5: 顶层 pet 呈现 mode —— 'full' 完整 240×240 / 'mini' 80×80 藏边. 默认 full */
  petMode: PetMode
}

const DEFAULT_PREFS: Preferences = {
  modelId: DEFAULT_MODEL,
  selectedModel: DEFAULT_SELECTED_MODEL,
  followFrontApp: true,
  useFastPath: true,
  visionEnabled: false,
  visionConsented: false,
  petMode: DEFAULT_PET_MODE
}

function prefsPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as {
        modelId?: unknown
        selectedModel?: unknown
        followFrontApp?: unknown
        useFastPath?: unknown
        visionEnabled?: unknown
        visionConsented?: unknown
        petMode?: unknown
      }
      const modelId = isValidModelId(obj.modelId) ? obj.modelId : DEFAULT_PREFS.modelId
      // M7-3 forward-compat migration:
      //   1. 文件已有合法 selectedModel → 用它（用户已被升过）
      //   2. 否则若文件里 modelId 是合法 Claude id → 推断 { provider:'anthropic', modelId }
      //      （单 Anthropic 时代用户的自然升级路径）
      //   3. 否则用 default
      let selectedModel: SelectedModel
      if (isValidSelectedModel(obj.selectedModel)) {
        selectedModel = obj.selectedModel
      } else if (isValidModelId(obj.modelId)) {
        selectedModel = { provider: 'anthropic', modelId: obj.modelId }
      } else {
        selectedModel = DEFAULT_PREFS.selectedModel
      }
      // Cross-field reconciliation：selectedModel 是新主字段，权威。
      // 如果用户手改文件让 modelId 跟 selectedModel.modelId drift（场景：
      // selectedModel='anthropic/claude-opus-4-7' + modelId='claude-haiku-4-5'），
      // 当 selectedModel 是 anthropic 时，强制 modelId 跟它对齐 —— legacy modelId
      // 字段失去发言权（@deprecated），不再让 hand-edit 制造两套真相。
      // 当 selectedModel 不是 anthropic 时，legacy modelId 保持原值（不可能跨 provider
      // 同步；wave 4 setModel 切 provider 时会单独维护 currentModel）。
      const reconciledModelId =
        selectedModel.provider === 'anthropic' && isValidModelId(selectedModel.modelId)
          ? selectedModel.modelId
          : modelId
      const followFrontApp =
        typeof obj.followFrontApp === 'boolean' ? obj.followFrontApp : DEFAULT_PREFS.followFrontApp
      const useFastPath =
        typeof obj.useFastPath === 'boolean' ? obj.useFastPath : DEFAULT_PREFS.useFastPath
      const visionEnabled =
        typeof obj.visionEnabled === 'boolean' ? obj.visionEnabled : DEFAULT_PREFS.visionEnabled
      const visionConsented =
        typeof obj.visionConsented === 'boolean'
          ? obj.visionConsented
          : DEFAULT_PREFS.visionConsented
      const petMode =
        typeof obj.petMode === 'string' && isPetMode(obj.petMode)
          ? obj.petMode
          : DEFAULT_PREFS.petMode
      return {
        modelId: reconciledModelId,
        selectedModel,
        followFrontApp,
        useFastPath,
        visionEnabled,
        visionConsented,
        petMode
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[prefs] load failed, falling back to default:', err)
    }
  }
  return { ...DEFAULT_PREFS }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  // 防御性 guard：TS 编译期已经限定，但 export public API 防御误用更稳
  if (!isValidModelId(prefs.modelId)) {
    throw new Error(`[prefs] refuse to save invalid modelId: ${String(prefs.modelId)}`)
  }
  if (!isValidSelectedModel(prefs.selectedModel)) {
    throw new Error(`[prefs] refuse to save invalid selectedModel`)
  }
  if (typeof prefs.followFrontApp !== 'boolean') {
    throw new Error(`[prefs] followFrontApp must be boolean`)
  }
  if (typeof prefs.useFastPath !== 'boolean') {
    throw new Error(`[prefs] useFastPath must be boolean`)
  }
  if (typeof prefs.visionEnabled !== 'boolean') {
    throw new Error(`[prefs] visionEnabled must be boolean`)
  }
  if (typeof prefs.visionConsented !== 'boolean') {
    throw new Error(`[prefs] visionConsented must be boolean`)
  }
  if (!isPetMode(prefs.petMode)) {
    throw new Error(`[prefs] refuse to save invalid petMode: ${String(prefs.petMode)}`)
  }
  const data = JSON.stringify(prefs, null, 2)
  await fs.writeFile(prefsPath(), data, { mode: 0o600 })
}
