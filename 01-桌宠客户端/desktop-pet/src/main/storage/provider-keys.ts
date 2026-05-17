/**
 * 多 provider API key 加密存储（M7-1）—— 镜像 credentials.ts / tavily-key.ts pattern
 * 但 generic 化：每个 provider 一个 .bin 文件，避免任一 key 损坏影响其它。
 *
 * 文件命名：
 *   anthropic-key.bin / openai-key.bin / google-key.bin / xai-key.bin /
 *   deepseek-key.bin / bytedance-key.bin
 *
 * 老 credentials.bin（Anthropic 单 key 时代）兼容：migration.ts 启动时把它的内容
 * 拷到 anthropic-key.bin 后删除原文件。
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { PROVIDERS, type Provider } from '../../shared/provider-types'

function keyPath(provider: Provider): string {
  return join(app.getPath('userData'), `${provider}-key.bin`)
}

/**
 * 读加密文件并解密。文件不存在 / 解密失败 / 引擎不可用 → null。
 *
 * 解密失败时主动 unlink 坏文件，避免下次启动还读同一份坏数据反复尝试。
 */
export async function loadProviderKey(provider: Provider): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await fs.readFile(keyPath(provider))
    const plain = safeStorage.decryptString(buf)
    return plain.trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn(`[provider-keys] decrypt failed for ${provider}, removing:`, err)
    void clearProviderKey(provider).catch((e) =>
      console.warn(`[provider-keys] cleanup failed for ${provider}:`, e)
    )
    return null
  }
}

export async function saveProviderKey(provider: Provider, key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 不可用：系统未提供加密后端')
  }
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key 为空')
  const encrypted = safeStorage.encryptString(trimmed)
  await fs.writeFile(keyPath(provider), encrypted, { mode: 0o600 })
}

export async function clearProviderKey(provider: Provider): Promise<void> {
  try {
    await fs.unlink(keyPath(provider))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

/** Dev 后门 —— env var 优先于落盘 key。 */
export function getProviderKeyFromEnv(provider: Provider): string | null {
  const envVar = PROVIDERS[provider].envVar
  const raw = process.env[envVar]?.trim()
  return raw && raw.length > 0 ? raw : null
}

/** 统一获取：env 优先 + 落盘兜底。 */
export async function resolveProviderKey(provider: Provider): Promise<string | null> {
  return getProviderKeyFromEnv(provider) ?? (await loadProviderKey(provider))
}

/**
 * 拉取所有 provider 的 key 是否存在 —— Settings UI 渲染卡片状态用。
 * 返回 boolean map，不返回明文 key（key 永远不出 main 进程）。
 */
export async function loadAllProviderKeyStatus(): Promise<Record<Provider, boolean>> {
  const result = {} as Record<Provider, boolean>
  for (const provider of Object.keys(PROVIDERS) as Provider[]) {
    result[provider] = (await resolveProviderKey(provider)) !== null
  }
  return result
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * 兼容老 credentials.bin（Anthropic 单 key 时代）—— 启动一次性 migration。
 * 老文件存在 → 解密 → 写入 anthropic-key.bin → 删老文件。
 * 失败时静默 keep 老文件，下次启动再试。
 */
export async function migrateLegacyCredentials(): Promise<void> {
  const legacyPath = join(app.getPath('userData'), 'credentials.bin')
  try {
    const buf = await fs.readFile(legacyPath)
    if (!safeStorage.isEncryptionAvailable()) return
    const plain = safeStorage.decryptString(buf)
    const trimmed = plain.trim()
    if (!trimmed) {
      // 空 → 直接删
      await fs.unlink(legacyPath)
      return
    }
    // 两文件并存语义（不应该常见）：
    //   - Wave 4.4 之后 key:submit / provider-key:submit 都直接写 anthropic-key.bin，
    //     不再写 credentials.bin —— 两文件并存只剩"用户从 wave 4.1-4.3 build 升级"
    //     这一窄场景（那个 build 的 legacy key:submit 还在写 credentials.bin）
    //   - 此时 anthropic-key.bin 是 wave 4 启动一次 migration 写的旧值；
    //     credentials.bin 是 wave 4.1-4.3 build 期间 user submit 的新值
    //   - 决策：保留 anthropic-key.bin（旧值）+ 删 credentials.bin（新值会丢）。
    //     这是已知 data-loss window，文档化在 CR consensus (wave 4.4 commit) 里；
    //     用户 wave 4.4 启动后再 submit 一次 key 就走新路径，不会再触发。
    //   - 不用 mtime 比较：复杂度 vs 受影响窗口太窄不值；wave 4.4 之后窗口闭合。
    const newPath = keyPath('anthropic')
    try {
      await fs.stat(newPath)
      await fs.unlink(legacyPath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
      // ENOENT 正常 → 落库
    }
    const encrypted = safeStorage.encryptString(trimmed)
    await fs.writeFile(newPath, encrypted, { mode: 0o600 })
    await fs.unlink(legacyPath)
    console.log('[provider-keys] migrated legacy credentials.bin → anthropic-key.bin')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return // 没有老文件，正常
    console.warn('[provider-keys] legacy migration failed (keeping old file):', err)
  }
}
