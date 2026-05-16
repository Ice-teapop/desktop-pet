/**
 * API key 加密本地存储（M2-2）。
 *
 * 走 Electron safeStorage：
 *  - macOS  → Keychain backed AES-256
 *  - Windows → DPAPI (用户登录态绑定)
 *  - Linux  → libsecret / kwallet；缺时 fallback 到 "basic" 弱加密（混淆而非真加密）
 *
 * 文件写入 app.getPath('userData')，命名 'credentials.bin'：
 *  - .bin 不暗示明文 / JSON 结构，降低被脚本扫描出来的概率
 *  - chmod 600 仅 owner 可读写（Windows 由 NTFS ACL 隔离，chmod 是 no-op）
 *
 * 这是「保护静态文件，不是 root 攻击者」。如果攻击者已经能跑用户态代码，
 * Electron 自己解的 key 一样在内存里 —— safeStorage 不防这个，无解。
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const FILE_NAME = 'credentials.bin'

function credPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/**
 * 读加密文件并解密。文件不存在 / 解密失败 / 引擎不可用 → null（让上层走"无 key"分支）。
 *
 * 解密失败时主动 unlink 坏文件，避免下次启动还读同一份坏数据反复尝试。
 * （场景：换机器 → Keychain 不识别这份加密载荷 / 文件位 corrupt / 引擎升级换格式）
 */
export async function loadApiKey(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await fs.readFile(credPath())
    const plain = safeStorage.decryptString(buf)
    return plain.trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn('[credentials] decrypt failed, removing corrupted file:', err)
    void clearApiKey().catch((e) => console.warn('[credentials] cleanup failed:', e))
    return null
  }
}

/** 加密并落盘。safeStorage 不可用时抛 —— 上层应当先 checkEncryptionAvailable。 */
export async function saveApiKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 不可用：系统未提供加密后端')
  }
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key 为空')
  const encrypted = safeStorage.encryptString(trimmed)
  await fs.writeFile(credPath(), encrypted, { mode: 0o600 })
}

/** 删除加密文件。文件本就不存在 → 静默通过。 */
export async function clearApiKey(): Promise<void> {
  try {
    await fs.unlink(credPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
