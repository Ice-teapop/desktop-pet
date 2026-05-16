/**
 * 用户档案持久化（M5-3）—— chmod 600 JSON。
 *
 * 跟 preferences.json 同级 —— 不加密（不敏感），但 chmod 600 OS 级权限隔离。
 * 启动时 load → main 内存常驻；AI 调 save_user_profile tool / 设置面板表单
 * 编辑都走 saveUserProfile 落盘 + 同步内存。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  DEFAULT_USER_PROFILE,
  type PersonaPreset,
  type UserProfile
} from '../../shared/user-profile-types'

const FILE_NAME = 'user-profile.json'

function profilePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

const VALID_PRESETS: PersonaPreset[] = [
  'warm-friend',
  'professional',
  'witty-cold',
  'playful',
  'custom'
]

function isValidPreset(v: unknown): v is PersonaPreset {
  return typeof v === 'string' && (VALID_PRESETS as string[]).includes(v)
}

/** 读：找不到 / 校验失败 → DEFAULT_USER_PROFILE。 */
export async function loadUserProfile(): Promise<UserProfile> {
  try {
    const raw = await fs.readFile(profilePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_USER_PROFILE }
    const obj = parsed as Record<string, unknown>
    return {
      name: typeof obj.name === 'string' ? obj.name : DEFAULT_USER_PROFILE.name,
      about: typeof obj.about === 'string' ? obj.about : DEFAULT_USER_PROFILE.about,
      personaPreset: isValidPreset(obj.personaPreset)
        ? obj.personaPreset
        : DEFAULT_USER_PROFILE.personaPreset,
      personaCustom:
        typeof obj.personaCustom === 'string'
          ? obj.personaCustom
          : DEFAULT_USER_PROFILE.personaCustom,
      setupCompleted:
        typeof obj.setupCompleted === 'boolean'
          ? obj.setupCompleted
          : DEFAULT_USER_PROFILE.setupCompleted
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[user-profile] load failed, using default:', err)
    }
    return { ...DEFAULT_USER_PROFILE }
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  if (typeof profile.name !== 'string') throw new Error('name must be string')
  if (typeof profile.about !== 'string') throw new Error('about must be string')
  if (!isValidPreset(profile.personaPreset)) {
    throw new Error('invalid personaPreset')
  }
  if (typeof profile.personaCustom !== 'string') {
    throw new Error('personaCustom must be string')
  }
  if (typeof profile.setupCompleted !== 'boolean') {
    throw new Error('setupCompleted must be boolean')
  }
  const sanitized: UserProfile = {
    name: profile.name.slice(0, 200),
    about: profile.about.slice(0, 2000),
    personaPreset: profile.personaPreset,
    personaCustom: profile.personaCustom.slice(0, 2000),
    setupCompleted: profile.setupCompleted
  }
  const data = JSON.stringify(sanitized, null, 2)
  await fs.writeFile(profilePath(), data, { mode: 0o600 })
}

/** 重置 setupCompleted=false 让 AI 下次对话重走 wizard。其它字段保留供 user 参考。 */
export async function resetUserProfileSetup(): Promise<UserProfile> {
  const current = await loadUserProfile()
  const reset: UserProfile = { ...current, setupCompleted: false }
  await saveUserProfile(reset)
  return reset
}

export function userProfilePath(): string {
  return profilePath()
}
