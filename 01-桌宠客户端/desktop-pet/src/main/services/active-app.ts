/**
 * 前台 App 事件监听（M3-3 C 方案 —— 真 0 延迟）。
 *
 * spawn 一个 Swift native binary（resources/frontmost-listener）订阅 macOS
 * NSWorkspace.didActivateApplicationNotification —— 任何 app 切前台立刻触发。
 * binary 通过 stdout 每行写一个 app 名给 main 进程读，比 osascript poll 每 5s（或
 * 500ms）反应快得多，且不占 CPU（事件驱动）。
 *
 * binary 失败 fallback：找不到 binary / spawn 报错 → 活动识别失效但 main 不崩
 * （桌宠永远显示 activity='idle'，等价于用户关掉「跟随前台 App」）。
 *
 * 同 state 去重：lastState 比对，相同 app 名重复（macOS 偶尔会重复通知）不重推。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ActivityState } from '../../shared/chat-types'

const BINARY_NAME = 'frontmost-listener'

interface ActivityPattern {
  regex: RegExp
  state: ActivityState
}

// 顺序敏感 —— 第一个匹配的赢，所以更具体的规则放前
const PATTERNS: ReadonlyArray<ActivityPattern> = [
  // 写代码：编辑器 / IDE
  {
    regex:
      /^(Code|Cursor|Xcode|IntelliJ|PyCharm|WebStorm|GoLand|Rider|CLion|RubyMine|PhpStorm|Android Studio|Sublime Text|Atom|Nova|Zed|Fleet|Neovim|MacVim|Emacs)$/i,
    state: 'coding'
  },
  // 终端
  {
    regex: /^(Terminal|iTerm2?|Warp|Alacritty|kitty|WezTerm|Hyper|Tabby)$/i,
    state: 'terminal'
  },
  // 写文档
  {
    regex:
      /^(Pages|Microsoft Word|Notion|Obsidian|Bear|Typora|Ulysses|Scrivener|Craft|Logseq|Roam|RemNote|MarginNote)$/i,
    state: 'writing'
  },
  // 沟通 / 聊天 / 邮件
  {
    regex:
      /^(Slack|Discord|WeChat|微信|Telegram|Messages|信息|Mail|邮件|Microsoft Teams|Zoom|FaceTime|Lark|飞书|DingTalk|钉钉|QQ)$/i,
    state: 'chatting'
  }
]

export function classifyApp(appName: string | null): ActivityState {
  if (!appName) return 'idle'
  for (const { regex, state } of PATTERNS) {
    if (regex.test(appName)) return state
  }
  return 'idle'
}

/** binary 路径：dev 在 project resources/，prod 在 .app/Contents/Resources/。 */
function locateBinary(): string | null {
  const candidate = is.dev
    ? join(__dirname, '../../resources', BINARY_NAME)
    : join(process.resourcesPath, BINARY_NAME)
  return existsSync(candidate) ? candidate : null
}

export class ActiveAppMonitor {
  private proc: ChildProcessWithoutNullStreams | null = null
  private running = false
  private lastState: ActivityState = 'idle'
  private stdoutBuffer = ''

  constructor(private onActivity: (state: ActivityState, appName: string | null) => void) {}

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
      // 默认 stdio: 'pipe' —— 三流都 pipe，stdin 虽然不用但类型保持
      // ChildProcessWithoutNullStreams（stdin/stdout/stderr 都非 null）
      proc = spawn(binary, [], { stdio: 'pipe' })
    } catch (err) {
      console.error('[active-app] spawn failed:', err)
      return
    }
    this.proc = proc
    this.running = true

    // local proc 引用让 TS 在闭包里不担心 this.proc 被并发改 null
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk
      let nl: number
      while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, nl).trim()
        this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1)
        this.handleLine(line || null)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      console.warn('[active-app] listener stderr:', chunk.toString())
    })

    proc.on('exit', (code, signal) => {
      if (this.running) {
        console.warn(`[active-app] listener exited unexpectedly code=${code} signal=${signal}`)
      }
      this.proc = null
      this.running = false
    })

    proc.on('error', (err) => {
      console.error('[active-app] proc error:', err)
    })
  }

  stop(): void {
    if (!this.running) {
      // 即使没 running 也确保 lastState 回 idle 推一次（启用过又关）
      if (this.lastState !== 'idle') {
        this.lastState = 'idle'
        this.onActivity('idle', null)
      }
      return
    }
    this.running = false
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
    if (this.lastState !== 'idle') {
      this.lastState = 'idle'
      this.onActivity('idle', null)
    }
  }

  private handleLine(appName: string | null): void {
    const state = classifyApp(appName)
    if (state !== this.lastState) {
      this.lastState = state
      this.onActivity(state, appName)
    }
  }
}
