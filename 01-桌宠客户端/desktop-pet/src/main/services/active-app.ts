/**
 * 前台 App 事件监听（M3-3-G —— LLM 分类版）。
 *
 * spawn Swift binary 订阅 NSWorkspace.didActivateApplicationNotification 真 0 延迟事件驱动。
 * binary 通过 stdout 每行写一个 app 名给 main 进程读。
 *
 * 这一层只负责"原始 app name 拿到 + debounce"，不做分类 —— 分类移到 main/llm/
 * activity-classifier.ts 由 LLM 处理（解耦 + 自主判断陌生 app）。
 *
 * binary 失败 fallback：找不到 / spawn 报错 → 不崩 main，活动识别失效保持 'idle'。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { join } from 'path'

const BINARY_NAME = 'frontmost-listener'

// **Leading + trailing 混合 debounce**（三方诊断 B 的核心修复）：
//  - 距上次 emit > QUIET_MS：立即 fire（leading edge）—— 用户切到新 app 立刻反应
//  - QUIET_MS 内连续切换：trailing debounce 抑制摇摆（Cmd-Tab 雪崩不雪崩桌宠 GIF）
// 之前纯 trailing 600ms 占总延迟 66%，改混合后 P50 ~620ms → ~60ms
const ACTIVITY_DEBOUNCE_MS = 400
const QUIET_MS = 800

// binary 意外退出后的自动重启策略（指数 backoff，限次防 binary 损坏死循环）
const MAX_RESTART_ATTEMPTS = 3
const RESTART_BASE_MS = 1000

/** binary 路径：dev 在 project resources/，prod 在 .app/Contents/Resources/。 */
function locateBinary(): string | null {
  const candidate = is.dev
    ? join(__dirname, '../../resources', BINARY_NAME)
    : join(process.resourcesPath, BINARY_NAME)
  return existsSync(candidate) ? candidate : null
}

/**
 * App identity —— Swift binary emit "bundleID\tname\n"，main 解析两字段后传给 callback。
 * bundleID 跨系统语言稳定（"com.microsoft.VSCode"），name 给 LLM 看本地化显示名。
 */
export interface AppIdentity {
  bundleId: string
  name: string
}

/**
 * App change callback：app=null 表示当前没前台 / detector 关闭 / 平台不支持。
 * main 进程在 callback 内 fast-path 或 LLM classify，更新 currentActivity。
 */
export type AppChangeHandler = (app: AppIdentity | null) => void

export class ActiveAppMonitor {
  private proc: ChildProcessWithoutNullStreams | null = null
  private running = false
  private lastApp: AppIdentity | null = null
  private stdoutBuffer = ''
  private pendingApp: AppIdentity | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private lastEmitAt = 0
  // cr W4: 意外退出重启计数 + 待重启 timer
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null

  constructor(private onAppChange: AppChangeHandler) {}

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    if (process.platform !== 'darwin') {
      console.log('[active-app] non-darwin platform, monitor disabled')
      return
    }

    const binary = locateBinary()
    if (!binary) {
      console.warn('[active-app] frontmost-listener binary not found, activity detection disabled')
      return
    }

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(binary, [], { stdio: 'pipe' })
    } catch (err) {
      console.error('[active-app] spawn failed:', err)
      return
    }
    this.proc = proc
    this.running = true
    this.restartAttempts = 0 // 成功 spawn 重置计数（healthy state）

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk
      let nl: number
      while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, nl)
        this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1)
        // 解析 "bundleID\tname" TSV；空行 / 解析失败 → null
        const trimmed = line.trim()
        if (!trimmed) {
          this.handleLine(null)
          continue
        }
        const tabIdx = trimmed.indexOf('\t')
        if (tabIdx < 0) {
          // 兼容老 binary 只 emit name 的格式
          this.handleLine({ bundleId: '', name: trimmed })
        } else {
          this.handleLine({
            bundleId: trimmed.slice(0, tabIdx),
            name: trimmed.slice(tabIdx + 1)
          })
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      console.warn('[active-app] listener stderr:', chunk.toString())
    })

    proc.on('exit', (code, signal) => {
      const wasUnexpected = this.running
      this.proc = null
      this.running = false
      if (wasUnexpected) {
        console.warn(`[active-app] listener exited unexpectedly code=${code} signal=${signal}`)
        this.scheduleRestart()
      }
    })

    proc.on('error', (err) => {
      console.error('[active-app] proc error:', err)
    })
  }

  stop(): void {
    if (!this.running) {
      if (this.lastApp !== null) {
        this.lastApp = null
        this.onAppChange(null)
      }
      return
    }
    this.running = false
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.restartAttempts = 0
    this.pendingApp = null
    if (this.lastApp !== null) {
      this.lastApp = null
      this.onAppChange(null)
    }
  }

  /**
   * binary 意外退出（macOS kill / panic / 自身崩）→ 指数 backoff 自动重启。
   * 1s → 2s → 4s 三次后放弃，避免 binary 损坏时死循环刷 CPU。
   * 成功 spawn 会 reset restartAttempts，所以偶尔崩一次不会累积。
   */
  private scheduleRestart(): void {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.error(
        `[active-app] gave up restart after ${this.restartAttempts} attempts; activity detection disabled until next user toggle`
      )
      return
    }
    const delay = RESTART_BASE_MS * Math.pow(2, this.restartAttempts)
    this.restartAttempts++
    console.warn(`[active-app] restarting in ${delay}ms (attempt ${this.restartAttempts})`)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.running) this.start()
    }, delay)
  }

  /**
   * Leading + trailing 混合 debounce：
   *  - 距上次 emit > QUIET_MS：当下立即 fire（让用户切新 app 立刻反应）
   *  - QUIET_MS 内连续切换：reset trailing timer 抑制 Cmd-Tab 摇摆雪崩
   * 用 bundleId 比 same（同 bundleId 不同 name 视为同 app，避免本地化名字抖动）
   */
  private handleLine(app: AppIdentity | null): void {
    const sameBundle = (this.lastApp?.bundleId ?? null) === (app?.bundleId ?? null)
    if (sameBundle) return // 同 app 不重复
    this.pendingApp = app
    const now = Date.now()
    if (now - this.lastEmitAt > QUIET_MS) {
      // leading edge：直接 fire，跳过 debounce
      this.flush()
      return
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.flush(), ACTIVITY_DEBOUNCE_MS)
  }

  private flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    const app = this.pendingApp
    this.pendingApp = null
    const sameBundle = (this.lastApp?.bundleId ?? null) === (app?.bundleId ?? null)
    if (sameBundle) return
    this.lastApp = app
    this.lastEmitAt = Date.now()
    this.onAppChange(app)
  }
}
