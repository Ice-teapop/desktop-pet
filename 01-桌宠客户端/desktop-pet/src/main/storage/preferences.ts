/**
 * 用户偏好持久化（M3-2）—— 当前只存 modelId，未来加更多偏好往这个文件加字段。
 *
 * 不用 safeStorage 加密 —— preference 不敏感（模型 ID 是公开信息，不像 API key）。
 * 写到 userData/preferences.json（跟 credentials.bin 同目录但语义独立）。
 *
 * 读：找不到文件 / 解析失败 / 字段缺失 → 返回 default（DEFAULT_MODEL）让 app 能起。
 * 写：JSON.stringify + chmod 600（不严格必要但跟 credentials 一致风格）。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_MODEL, isValidModelId, type ModelId } from '../../shared/chat-types'

const FILE_NAME = 'preferences.json'

export interface Preferences {
  modelId: ModelId
  /** 跟随前台 App 自动识别活动（写代码 / 写文档...）—— 默认开，用户托盘可关 */
  followFrontApp: boolean
  /** fast-path bundleID regex 白名单：默认开（常见 app 1ms 命中），关 = 严格 LLM 识别 */
  useFastPath: boolean
  /** 视觉感知：每次发消息时附带屏幕截图给 Claude vision（M4-A-3）—— 默认关 */
  visionEnabled: boolean
  /** 用户是否同意过隐私 modal（截图发 Anthropic）—— 一次性，consent 后才能 enable */
  visionConsented: boolean
}

const DEFAULT_PREFS: Preferences = {
  modelId: DEFAULT_MODEL,
  followFrontApp: true,
  useFastPath: true,
  visionEnabled: false,
  visionConsented: false
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
        followFrontApp?: unknown
        useFastPath?: unknown
        visionEnabled?: unknown
        visionConsented?: unknown
      }
      const modelId = isValidModelId(obj.modelId) ? obj.modelId : DEFAULT_PREFS.modelId
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
      return { modelId, followFrontApp, useFastPath, visionEnabled, visionConsented }
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
  const data = JSON.stringify(prefs, null, 2)
  await fs.writeFile(prefsPath(), data, { mode: 0o600 })
}
