/**
 * Per-action approval flow（M4-C）—— main ↔ renderer 的同步 approval 通信。
 *
 * Tool 执行高风险动作（fs/cmd/defaults_write）前调用 requestApproval(req)，
 * 返回 Promise<ApprovalDecision>。main 端通过 IPC 发请求给 renderer，等用户
 * 在 ApprovalModal 点击后 response 回来 resolve promise。
 *
 * 信任目录池（trust set）：
 *  - **会话级** sessionTrustedDirs：进程内存，主进程退出即丢
 *  - **持久级** persistentTrustedDirs：写到 userData/trusted-dirs.json（chmod 600），
 *    启动 load 进内存
 *  - 检查：给定路径，看是否在任一 trusted 目录的子树下 → silent allow
 *
 * 安全设计：
 *  - 持久 trust 写盘前要求用户在 modal 显式点了"永久信任"
 *  - 信任目录路径用 normalize/resolve 后绝对路径 + 末尾 '/'，防 prefix-match bypass
 *    （"/Users/alice/Docs" 不应匹配 "/Users/alice/DocsBackup"）
 *  - main 退出时 sessionTrustedDirs 丢弃 → 防 modal 疲劳
 */
import { BrowserWindow, ipcMain, app } from 'electron'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { join, normalize, resolve, sep } from 'path'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/approval-types'
import { isInDefaultTrustedScope } from './path-safety'

const PERSIST_FILE = 'trusted-dirs.json'

function persistPath(): string {
  return join(app.getPath('userData'), PERSIST_FILE)
}

const sessionTrustedDirs = new Set<string>()
const persistentTrustedDirs = new Set<string>()

/** 把目录标准化成 "absolute_path/" 形式（带末尾 sep）便于 prefix 匹配。 */
function normDir(p: string): string {
  const abs = normalize(resolve(p))
  return abs.endsWith(sep) ? abs : abs + sep
}

/**
 * 启动时加载持久化的 trusted dirs。
 * 找不到文件 / 解析失败 → 空集合（trust 列表零信任启动）。
 */
export async function loadPersistentTrustedDirs(): Promise<void> {
  try {
    const raw = await fs.readFile(persistPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      persistentTrustedDirs.clear()
      for (const p of parsed) {
        if (typeof p === 'string') persistentTrustedDirs.add(normDir(p))
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn('[approval] load trusted dirs failed:', err)
  }
}

async function savePersistentTrustedDirs(): Promise<void> {
  try {
    const arr = [...persistentTrustedDirs].map((d) => d.replace(/\/$/, ''))
    await fs.writeFile(persistPath(), JSON.stringify(arr, null, 2), { mode: 0o600 })
  } catch (err) {
    console.warn('[approval] save trusted dirs failed:', err)
  }
}

/**
 * 检查给定路径是否在任一 trusted 目录下。
 * 返回 'default' / 'session' / 'persistent' / null。
 *
 * 'default' 表示路径在 HOME 下 visible 顶级目录里（Documents、Projects 等）——
 * 这是 M4-C-4 后放宽的默认信任范围，user 不需要点 modal 即可访问/修改。
 * 黑名单仍由调用方先用 isPathSafe 检查（这里假设调用方已过了 isPathSafe）。
 */
export function checkTrusted(absPath: string): 'default' | 'session' | 'persistent' | null {
  const normalized = normalize(resolve(absPath))
  // 持久 + 会话信任优先（用户显式信任过的精确目录）
  for (const dir of persistentTrustedDirs) {
    if (normalized + sep === dir || normalized.startsWith(dir)) return 'persistent'
  }
  for (const dir of sessionTrustedDirs) {
    if (normalized + sep === dir || normalized.startsWith(dir)) return 'session'
  }
  // 默认信任范围（HOME 下 visible 顶级目录）
  if (isInDefaultTrustedScope(normalized)) return 'default'
  return null
}

export function getTrustedDirsSnapshot(): {
  session: string[]
  persistent: string[]
} {
  return {
    session: [...sessionTrustedDirs].map((d) => d.replace(/\/$/, '')),
    persistent: [...persistentTrustedDirs].map((d) => d.replace(/\/$/, ''))
  }
}

/** 撤销一个持久信任目录。 */
export async function revokePersistentTrust(dir: string): Promise<void> {
  const n = normDir(dir)
  if (persistentTrustedDirs.delete(n)) {
    await savePersistentTrustedDirs()
  }
}

export function revokeAllSessionTrust(): void {
  sessionTrustedDirs.clear()
}

let petWindowRef: BrowserWindow | null = null
export function setApprovalPetWindow(win: BrowserWindow | null): void {
  petWindowRef = win
}

/** 单条 approval 用户响应窗口 (modal 真显示后开始计时) */
const APPROVAL_TIMEOUT_MS = 60_000

/**
 * Pending entry：包 resolver + timer，IPC response 来了能 clearTimeout 防 race。
 * cr-fix S3：之前只存 resolver，timer 不被取消，存在窗口期 race（用户 59.9s 点
 * allow 但 timer 已经在 60s 时 fire deny）。
 *
 * fix (queue race): timer 初始为 null, 在 renderer 发 'approval:displayed' 后
 * 才启动。原 60s 从入队时起算 → 队列里第 N 个 request 在前 N-1 个被处理期间
 * 静默 timeout 被 auto-deny。改成"真显示后才计时"，每个 request 都有完整 60s。
 */
interface PendingEntry {
  resolve: (decision: ApprovalDecision) => void
  timer: NodeJS.Timeout | null
  /** 防 stuck: queue 即使一直不显示也要兜底, 入队 +5min 后强制 fire */
  fallbackTimer: NodeJS.Timeout
}

const pendingEntries = new Map<string, PendingEntry>()

/** 入队后多久还没收到 'displayed' 就强制 fail-safe deny (5 min) */
const APPROVAL_QUEUE_STUCK_MS = 5 * 60_000

/**
 * 请求用户审批。如果 petWindow 不可用（启动时序异常），直接 deny。
 * Promise 永远 resolve（不会 reject），由 decision 区分 allow/deny。
 */
export async function requestApproval(req: Omit<ApprovalRequest, 'id'>): Promise<ApprovalDecision> {
  if (!petWindowRef || petWindowRef.isDestroyed()) {
    console.warn('[approval] no pet window, auto-deny')
    return 'deny'
  }
  const id = 'apr_' + randomBytes(8).toString('hex')
  return new Promise<ApprovalDecision>((resolve) => {
    // fallback: 入队后 5min 还没显示 (renderer crash / queue stuck) 强制 deny
    const fallbackTimer = setTimeout(() => {
      const entry = pendingEntries.get(id)
      if (entry && entry.fallbackTimer === fallbackTimer) {
        if (entry.timer) clearTimeout(entry.timer)
        pendingEntries.delete(id)
        console.warn(`[approval] queue stuck >${APPROVAL_QUEUE_STUCK_MS}ms, auto-deny: ${id}`)
        entry.resolve('deny')
      }
    }, APPROVAL_QUEUE_STUCK_MS)
    pendingEntries.set(id, { resolve, timer: null, fallbackTimer })
    petWindowRef!.webContents.send('approval:request', { id, ...req })
  })
}

/**
 * 注册 IPC handlers —— main 启动时调一次。
 * 接收用户决策；如果是 trust-dir-* 还要把 path's 父目录加进对应 trust set。
 *
 * cr-fix S3：拿到 response 立即 clearTimeout 防 timer fire 二次 resolve。
 */
export function registerApprovalIpc(): void {
  ipcMain.on('approval:displayed', (_event, id: string) => {
    const entry = pendingEntries.get(id)
    if (!entry || entry.timer !== null) return // 已启过 / 不存在
    entry.timer = setTimeout(() => {
      const e = pendingEntries.get(id)
      if (e && e.timer) {
        clearTimeout(e.fallbackTimer)
        pendingEntries.delete(id)
        e.resolve('deny')
      }
    }, APPROVAL_TIMEOUT_MS)
  })
  ipcMain.on(
    'approval:response',
    async (_event, id: string, decision: ApprovalDecision, dirToTrust?: string) => {
      const entry = pendingEntries.get(id)
      if (!entry) return
      pendingEntries.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
      clearTimeout(entry.fallbackTimer)
      if (decision === 'trust-dir-session' && dirToTrust) {
        sessionTrustedDirs.add(normDir(dirToTrust))
      }
      if (decision === 'trust-dir-permanent' && dirToTrust) {
        persistentTrustedDirs.add(normDir(dirToTrust))
        await savePersistentTrustedDirs()
      }
      entry.resolve(decision)
    }
  )
}
