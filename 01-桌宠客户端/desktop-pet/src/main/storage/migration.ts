/**
 * 一次性 userData 路径迁移 —— 旧版 .app / dev mode 把 credentials.bin 和
 * preferences.json 存在 ~/Library/Application Support/desktop-pet/（package.json
 * name 字段 fallback）。productName='DeskPet' 后路径变成 .../DeskPet/。
 *
 * 用 rename（不是 copy）—— 同 fs 是原子的，且能保证 legacy 那份不会作为「被遗忘的
 * 加密 key」永远残留在磁盘（cr 反复指出的同根问题：分裂的 userData 让重设 key 只清
 * 一份）。两边都有时以 current 为准并删 legacy。
 *
 * Idempotent：多次启动不会重复操作。
 *
 * ─── 🔔 Sunset Target: v1.0.0 ────────────────────────────────────────
 * 引入于 v0.0.1 (2026-05-15) —— productName 改名时的 userData 目录迁移.
 * 幂等保证: 检查旧目录存在 + fs.rename 原子搬, 搬完旧目录自动消失.
 *
 * 删除时机: v1.0.0 cut branch 时. 理由:
 *   - v0.4.x → v1.0.0 是 8+ 月 SemVer 大跨度, 老用户启动过 ≥1 次 → 已迁完
 *   - 删后省 73 行 + 启动 I/O 2 步
 *   - 新用户从 v1.0 开始装机不存在 legacy 目录
 * 删除前确认: CHANGELOG 中 v1.0 release notes 写明 "drop pre-v0.x migration".
 * ─────────────────────────────────────────────────────────────────────
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const LEGACY_APP_NAME = 'desktop-pet'
const FILES_TO_MIGRATE = ['credentials.bin', 'preferences.json']

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function migrateLegacyUserData(): Promise<void> {
  const currentDir = app.getPath('userData')
  const legacyDir = join(app.getPath('appData'), LEGACY_APP_NAME)

  // 当前路径就是 legacy（用户没改 productName 或 fallback 到 name）—— 无需迁
  if (currentDir === legacyDir) return

  if (!(await fileExists(legacyDir))) return

  // 新目录可能还不存在（首次启动），先确保
  try {
    await fs.mkdir(currentDir, { recursive: true })
  } catch (err) {
    console.warn('[migration] mkdir currentDir failed:', err)
    return
  }

  for (const filename of FILES_TO_MIGRATE) {
    const legacyPath = join(legacyDir, filename)
    const currentPath = join(currentDir, filename)

    const legacyHas = await fileExists(legacyPath)
    if (!legacyHas) continue

    const currentHas = await fileExists(currentPath)
    if (currentHas) {
      // 两边都有 → current 是权威（用户后来贴的 key），删 legacy 避免敏感残留
      try {
        await fs.unlink(legacyPath)
        console.log(`[migration] removed legacy ${filename} (current already exists)`)
      } catch (err) {
        console.warn(`[migration] failed to remove legacy ${filename}:`, err)
      }
      continue
    }

    // 只 legacy 有 → rename 搬过来（原子操作）
    try {
      await fs.rename(legacyPath, currentPath)
      await fs.chmod(currentPath, 0o600)
      console.log(`[migration] moved ${filename}: ${legacyDir}/ → ${currentDir}/`)
    } catch (err) {
      console.warn(`[migration] failed to move ${filename}:`, err)
    }
  }
}
