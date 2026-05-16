/**
 * Tavily Search API key 加密本地存储（M4-D）。
 *
 * 设计跟 credentials.ts 完全镜像（safeStorage encryptString → tavily-key.bin
 * chmod 600）。独立文件而非合进 credentials.bin —— 两个 API key 生命周期独立
 * 轮换；任一损坏不影响另一个。
 *
 * 加载优先级：
 *   1. process.env.TAVILY_API_KEY  （dev 用）
 *   2. 加密文件 ~/Library/Application Support/DeskPet/tavily-key.bin
 *   3. null  → web_search tool 不暴露给 AI
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const FILE_NAME = 'tavily-key.bin'

function tavilyPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

export function getTavilyKeyFromEnv(): string | null {
  const raw = process.env.TAVILY_API_KEY?.trim()
  return raw && raw.length > 0 ? raw : null
}

/** 读加密文件 + 解密。失败 / 不存在 → null。 */
export async function loadTavilyKey(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await fs.readFile(tavilyPath())
    const plain = safeStorage.decryptString(buf)
    return plain.trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn('[tavily-key] decrypt failed, removing:', err)
    void clearTavilyKey().catch((e) => console.warn('[tavily-key] cleanup failed:', e))
    return null
  }
}

export async function saveTavilyKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 不可用')
  }
  const trimmed = key.trim()
  if (!trimmed) throw new Error('tavily key 为空')
  const encrypted = safeStorage.encryptString(trimmed)
  await fs.writeFile(tavilyPath(), encrypted, { mode: 0o600 })
}

export async function clearTavilyKey(): Promise<void> {
  try {
    await fs.unlink(tavilyPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

/** 启动时统一拿 token —— env 优先于落盘。 */
export async function resolveTavilyKey(): Promise<string | null> {
  return getTavilyKeyFromEnv() ?? (await loadTavilyKey())
}
