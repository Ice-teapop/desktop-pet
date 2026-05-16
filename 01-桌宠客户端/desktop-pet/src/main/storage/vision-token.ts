/**
 * Vision 服务 Bearer token 加密存储（M4-A-2）。
 *
 * 同 credentials.ts 一样走 Electron safeStorage：
 *  - macOS  → Keychain backed AES-256
 *  - Windows → DPAPI
 *  - Linux  → libsecret / kwallet
 *
 * 写入 userData/vision-token.bin，chmod 600。.bin 扩展不暗示明文。
 *
 * 风险定位：Bearer token 是发到自己服务器的 Bearer secret，泄露风险等同于
 * 服务被 RCE —— 任何能跑用户态代码的攻击者都能从内存读到。safeStorage 只
 * 防"扫硬盘找明文"这一类弱攻击。
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const FILE_NAME = 'vision-token.bin'

function tokenPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 读加密文件并解密。任何失败 → null（让上层走"无 token"分支）。 */
export async function loadVisionToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await fs.readFile(tokenPath())
    const plain = safeStorage.decryptString(buf)
    return plain.trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn('[vision-token] decrypt failed, removing corrupted file:', err)
    void clearVisionToken().catch((e) => console.warn('[vision-token] cleanup failed:', e))
    return null
  }
}

export async function saveVisionToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 不可用：系统未提供加密后端')
  }
  const trimmed = token.trim()
  if (!trimmed) throw new Error('vision token 为空')
  const encrypted = safeStorage.encryptString(trimmed)
  await fs.writeFile(tokenPath(), encrypted, { mode: 0o600 })
}

export async function clearVisionToken(): Promise<void> {
  try {
    await fs.unlink(tokenPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}
