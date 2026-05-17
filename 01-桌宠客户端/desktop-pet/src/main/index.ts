/**
 * DeskPet 主进程 — M3-3-D（累计 M2 / M3 + 活动识别 + GIF 真动画 + Swift 事件驱动）。
 *
 * 核心机制：
 *  - 启动 key 解析顺序：env ANTHROPIC_API_KEY > userData/credentials.bin > missing
 *  - 启动 model 解析：userData/preferences.json > DEFAULT_MODEL（'claude-haiku-4-5'）
 *  - 启动 followFrontApp：同 prefs，默认 true
 *  - 旧目录迁移：migrateLegacyUserData() 把 desktop-pet/ 的 credentials.bin + prefs
 *    一次性 rename 到 DeskPet/（productName 改名时的兼容补丁）
 *  - 主进程是 keyState / chatHistory / currentModel / currentActivity 单一事实来源
 *
 * 三大 IPC 流：
 *  - chat:* → LLM 流式（M2-1）：chunk / done / error，token + AbortController 双保险
 *  - key:* → API key 生命周期（M2-2）：submit / reset / request-state，safeStorage 加密
 *  - pet:state / pet:activity → 桌宠状态（M3-3）：state 由 LLM 流推，activity 由
 *    Swift binary 事件驱动推（NSWorkspaceDidActivateApplicationNotification）
 *
 * 托盘菜单：当前活动 readonly · 跟随前台 App checkbox · 重设 API Key · 模型 radio ·
 *  显示隐藏 · 重置位置 · 退出
 *
 * 健壮性补丁（cr-fix 累计）：
 *  - chatTurnToken / currentStreamHandle 双保险：resetKey / setModel 触发后旧 stream
 *    callback 自我跳过 + 真正的 SDK fetch abort（避免白烧 token）
 *  - queueCredentialOp：串行化 saveApiKey/clearApiKey（防 unlink 删刚写的 key）
 *  - schedulePrefsSave：debounce 200ms（防快速连切丢 race）
 *  - setModel 中断清理：chat:done + pop user turn + transition idle，解 streaming 气泡 stuck
 *  - migrate + productName=DeskPet：dev / prod 共用同一 userData 路径
 *  - devTools: is.dev：production build 关 F12 防 IPC 嗅探
 *
 * 沿用 M1-8 的窗口策略：智能扩展方向 + 开/关屏两阶段过渡 + NSPanel + screen-saver level
 *  + reapplyMacVisibility watchdog。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  PET_STATES,
  RENDERER_FADE_HALF_MS,
  type PetState,
  type PetAnimation
} from '../shared/pet-state'
import {
  DEFAULT_PET_MODE,
  MINI_SNAP_THRESHOLD_PX,
  MINI_VISIBLE_PX,
  MINI_WIN_HEIGHT,
  MINI_WIN_WIDTH,
  isPetMode,
  type PetMode
} from '../shared/pet-mode'
import {
  ACTIVITY_INFO,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  isValidModelId,
  type ActivityState,
  type ChatMessage,
  type KeyState,
  type ModelId
} from '../shared/chat-types'
import {
  DEFAULT_SELECTED_MODEL,
  PROVIDER_ORDER,
  isValidProvider,
  isValidSelectedModel,
  type Provider,
  type ProviderKeyStates,
  type SelectedModel
} from '../shared/provider-types'
import { LlmClient, type StreamHandle } from './llm/llm-client'
import { instantiateModelSync } from './llm/providers'
import {
  classifyApp,
  clearClassifyCache,
  tryFastPath,
  warmupClassifier,
  type AppIdentity
} from './llm/activity-classifier'
// M7-4 wave 4.4: credentials.ts 的 saveApiKey/clearApiKey 不再使用 —— 老 key:submit /
// key:reset IPC 改走 saveProviderKey('anthropic', key) / clearProviderKey('anthropic')
// 直接写新格式 anthropic-key.bin（不再经过 credentials.bin → migration 二跳）。
// credentials.ts 文件本身 wave 5 cleanup 时再删；现在只是 unused 导出。
import {
  migrateLegacyCredentials,
  resolveProviderKey,
  saveProviderKey,
  clearProviderKey
} from './storage/provider-keys'
import { loadPreferences, savePreferences, type Preferences } from './storage/preferences'
import { migrateLegacyUserData } from './storage/migration'
import { loadTheme } from './storage/theme'
import { ActiveAppMonitor } from './services/active-app'
import { createSettingsWindow } from './services/settings-window'
// M7-4: llm/tools 老 ToolDef + buildToolsForContext + executeTool 路径已被
// llm-client.ts 内部 buildToolSetForContext (AI SDK ToolSet) 取代 —— chat:submit
// handler 只传 toolContext 给 LlmClient，SDK 自己跑 tool loop。tools.ts 老 export
// 仍保留供 tool-defs.ts 共享 description 字符串跟 ToolContext type（wave 4.3+ 收尾）。
import {
  getTrustedDirsSnapshot,
  loadPersistentTrustedDirs,
  registerApprovalIpc,
  revokeAllSessionTrust,
  revokePersistentTrust,
  setApprovalPetWindow
} from './llm/approval'
import {
  clearTavilyKey,
  resolveTavilyKey,
  saveTavilyKey
} from './storage/tavily-key'
import { clearAuditLog, logPath as auditLogPath } from './audit-log'
import {
  chatHistoryPath,
  clearChatHistory,
  loadChatHistory,
  saveChatHistory
} from './storage/chat-history'
import {
  clearMemory,
  loadMemory,
  petMemoryPath,
  setMemory
} from './storage/pet-memory'
import {
  loadUserProfile,
  resetUserProfileSetup,
  saveUserProfile,
  userProfilePath
} from './storage/user-profile'
import {
  DEFAULT_USER_PROFILE,
  type UserProfile
} from '../shared/user-profile-types'
import type { VisionState } from '../shared/vision-types'
import type { TavilyState } from '../shared/tavily-types'
import trayIconPath from '../../resources/icon.png?asset'

// userData 路径走 package.json 的 productName='DeskPet' —— Electron 启动早期就读
// package.json 决定 app.getName()，dev / prod 都用 ~/Library/Application Support/DeskPet/。
// 之前用 app.setName('DeskPet') 时序偏晚 —— 在某些路径上 userData 已经按 name='desktop-pet'
// 创建过；改 productName 是更早 + 更稳的方式。旧目录 desktop-pet/credentials.bin 由
// migrateLegacyUserData() 在 startup 自动搬到新目录。

const WIN_WIDTH_COMPACT = 260
const WIN_WIDTH_FULL = 500
const WIN_HEIGHT = 280
const MARGIN_FROM_EDGE = 24
const VISIBILITY_WATCHDOG_MS = 1000
const WINDOW_RESIZE_ANIM_MS = 320

const SUCCESS_HOLD_MS = PET_STATES.success.minMs + 100
const ERROR_HOLD_MS = PET_STATES.error.minMs + 100
const MAX_HISTORY_PAIRS = 10

/** M9-3: sleep chain 内部 state（chain timer fire 时切到下一个，不要 clearSleepChain） */
const SLEEP_CHAIN_STATES: ReadonlySet<PetState> = new Set([
  'yawning',
  'dozing',
  'collapsing',
  'sleep'
])

class PetStateMachine {
  private current: PetState = 'idle'
  private enteredAt = Date.now()
  private timer: NodeJS.Timeout | null = null
  // M9-3: 多 timer 数组（4 个 setTimeout 串：→yawning →dozing →collapsing →sleep）
  // wake / 任何 user activity 整数组 clearTimeout 防"睡了又被旧 timer 拉回去"
  private sleepChainTimers: NodeJS.Timeout[] = []

  constructor(private notify: (state: PetState) => void) {
    // M8 fix (Officer A cold-start ⚠️): seed current='idle' 不走 transition()，
    // 不会自动 arm chain。冷启动后若 user 不发 chat 也不动 pet，永远停在 idle
    // 不进 sleep —— 违反 "60s idle → sleep" 语义。constructor 显式 arm 一次。
    this.armSleepChain()
  }

  getState(): PetState {
    return this.current
  }

  transition(target: PetState): boolean {
    if (target === this.current) return false
    const tPrio = PET_STATES[target].priority
    const cPrio = PET_STATES[this.current].priority
    const elapsed = Date.now() - this.enteredAt
    const cMin = PET_STATES[this.current].minMs
    if (tPrio > cPrio || elapsed >= cMin) {
      this.current = target
      this.enteredAt = Date.now()
      this.notify(target)
      // M8 / M9-3: state machine 自维护 sleep chain timer
      // - 进 idle → arm 60s chain（chain 内部 timer 串 yawning→dozing→collapsing→sleep）
      // - 切到 sleep chain 内部 state（chain timer fire 时）→ 保留剩余 timer 不动
      // - 切到任何非-chain state → clear chain（防 stale timer 把 pet 拉回 dozing 等）
      if (target === 'idle') {
        this.armSleepChain()
      } else if (!SLEEP_CHAIN_STATES.has(target)) {
        this.clearSleepChain()
      }
      // else: target ∈ SLEEP_CHAIN_STATES 是 chain timer 自己 fire 的 transition，
      // 保留后续 timer（如 dozing 进 chain 时 collapsing/sleep timer 还在排队）
      return true
    }
    return false
  }

  /**
   * M9-3: 多阶段 sleep chain（Officer A+B 共识 nested 修 race）
   *
   * 旧 absolute 4 setTimeout（t+60s/+61.5s/+63s/+64.5s）有 race：yawning
   * timer fire 慢 50ms (jitter) → dozing timer 在 absolute 61500ms fire 时
   * yawning enteredAt=60050ms → elapsed=1450 < 1500 → blocked → dozing 帧
   * 被吞 → user 看 yawn → collapse → sleep 缺一阶段。
   *
   * 新 nested 方案：每个 phase 成功 transition 后才 schedule 下一个 phase。
   * setTimeout(delay) 从 callback 内 schedule，delay 是相对 callback 执行
   * 时刻；callback 执行时刻就是该 phase enteredAt。所以下次 fire 时
   * elapsed = 实际 delay (>= setTimeout delay >= minMs) → 永远满足 minMs gate.
   *
   * SVG 动画 dur 跟阶段 minMs 1:1 对齐（pet-state.ts 注释）：
   *   60000ms idle  → yawning（3.8s SVG, minMs 3800）
   *   3800ms yawning → dozing（4s SVG infinite, 砍一个周期）
   *   4000ms dozing  → collapsing（1s SVG）
   *   1000ms collapsing → sleep（永久 sleeping GIF）
   */
  private armSleepChain(): void {
    this.clearSleepChain()
    const chain: ReadonlyArray<readonly [number, PetState]> = [
      [IDLE_SLEEP_MS, 'yawning'],
      [PET_STATES.yawning.minMs, 'dozing'],
      [PET_STATES.dozing.minMs, 'collapsing'],
      [PET_STATES.collapsing.minMs, 'sleep']
    ]
    const step = (i: number): void => {
      if (i >= chain.length) return
      const [delay, target] = chain[i]
      this.sleepChainTimers.push(
        setTimeout(() => {
          // 仅当 transition 成功才 schedule 下一阶段 —— 防 race / 防 user wake
          // 后 chain 还继续推进。clearSleepChain 走 wake / non-chain transition
          // 路径已经把这个 setTimeout 干掉，下面 step(i+1) 不会跑到。
          if (this.transition(target)) step(i + 1)
        }, delay)
      )
    }
    step(0)
  }

  private clearSleepChain(): void {
    for (const t of this.sleepChainTimers) clearTimeout(t)
    this.sleepChainTimers = []
  }

  /**
   * 任何用户活动 wake —— 从 sleep chain 任意阶段 (yawning/dozing/collapsing/sleep)
   * 转到 'waking' state 播 1500ms wake SVG 后回 idle。waking priority 2 高于 chain
   * priority 1 → 一定能 transition 成功，不会被 minMs 阻塞。
   *
   * Officer B 校准：clawd-wake.svg dur=1.5s，scheduleReturnToIdle 给足 1500ms
   * 让 wake 动画播完整（旧值 800ms 砍掉 svg 后半段）。
   */
  wakeFromSleep(): void {
    if (SLEEP_CHAIN_STATES.has(this.current)) {
      // transition('waking') 内部 hook：waking ∉ SLEEP_CHAIN_STATES 走 else 分支
      // 调 clearSleepChain（清掉可能 pending 的后续 chain timer）
      if (this.transition('waking')) {
        this.scheduleReturnToIdle(1500)
      }
    }
  }

  demoCycle(): void {
    if (this.timer) clearTimeout(this.timer)
    this.transition('thinking')
    this.timer = setTimeout(() => {
      this.transition('success')
      this.timer = setTimeout(() => {
        this.transition('idle')
        this.timer = null
      }, SUCCESS_HOLD_MS)
    }, 2000)
  }

  scheduleReturnToIdle(holdMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.transition('idle')
      this.timer = null
    }, holdMs)
  }
}

/** M8: idle 多久后自动 sleep。60s 跟 clawd-on-desk 一致 */
const IDLE_SLEEP_MS = 60_000

/**
 * M9-4 eye tracking: main 端轮询全局 cursor，推 dx/dy 给 renderer 让 inline SVG
 * 眼球/身体/影子跟随。renderer 在 panel 外收不到 mousemove（DOM mousemove 只
 * 当 cursor 在 webContents 区域内 fire），所以必须 main 端 polling。
 *
 * 33ms ≈ 30Hz，跟 renderer rAF (60Hz 但实际很多 frame 一致) 协调够用；CPU
 * 负担经测 < 0.5% (screen.getCursorScreenPoint 是 sync native call)。
 */
const CURSOR_POLL_MS = 33
let cursorPollTimer: NodeJS.Timeout | null = null

function startCursorPoll(): void {
  if (cursorPollTimer) return
  cursorPollTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = petWindow.getBounds()
    const dx = cursor.x - (bounds.x + bounds.width / 2)
    const dy = cursor.y - (bounds.y + bounds.height / 2)
    petWindow.webContents.send('pet:cursor', { dx, dy })
  }, CURSOR_POLL_MS)
}

function stopCursorPoll(): void {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer)
    cursorPollTimer = null
  }
}

/**
 * M9-5a: 顶层 petMode 状态 —— 'full' (240×240 normal) vs 'mini' (80×80 藏边).
 * 跟 PetState 正交：mini mode 下 state 仍是 idle/sleep/thinking，但 renderer
 * 走不同 render path（只用 mini-* GIF）。切换通过 setPetMode(mode)。
 */
let petMode: PetMode = DEFAULT_PET_MODE

function broadcastPetMode(): void {
  // 单播给 petWindow（跟 pet:state / pet:cursor 拓扑对齐；settings 等其它 window 不需要这条 channel）
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:mode', petMode)
  }
}

/**
 * 切换 pet mode 并 resize/reposition window。
 * - mini: 80×80, 藏在 workArea 右边（只露 MINI_VISIBLE_PX = 24px）
 * - full: 260×280, 回到右下角 MARGIN_FROM_EDGE
 *
 * Sub-wave A: 直接 setBounds（无 animate），无抛物线 —— C 阶段加 60Hz JS 插值。
 * Mini mode 时强制 stopCursorPoll（cursor poll 只服务 full+idle eye tracking）。
 */
/**
 * M9-5b B-1: 纯函数算 mode 对应窗口 bounds（无副作用）—— 拆出来给 sub-wave C 抛物线
 * 动画用：动画期间需要 60Hz setBounds 但不动 module state petMode / rebuildTrayMenu /
 * broadcastPetMode。setPetMode 是 "状态切换 + 应用 bounds"，applyModeBounds 是 "光算 bounds"。
 *
 * 接受可选 currentBounds 参数（决定 display）—— 无参数时用 primary display.
 */
function computeModeBounds(
  mode: PetMode,
  currentBounds?: Electron.Rectangle
): Electron.Rectangle {
  let display = currentBounds
    ? screen.getDisplayMatching(currentBounds)
    : screen.getPrimaryDisplay()
  let wa = display.workArea
  // 防御: fullscreen Space / 退化 display config 时 workArea 可能塌缩到极小值（macOS
  // 部分版本 + Spaces 转换边缘），直接 setBounds 会把窗口扔到屏外。落主屏的 bounds 兜底。
  if (wa.width < 200 || wa.height < 200) {
    console.warn('[computeModeBounds] degenerate workArea, fallback to primary display:', wa)
    display = screen.getPrimaryDisplay()
    wa = display.workArea.width < 200 ? display.bounds : display.workArea
  }
  if (mode === 'mini') {
    // 大部分藏在 workArea 右边外 —— 仅 MINI_VISIBLE_PX 露出
    return {
      x: wa.x + wa.width - MINI_VISIBLE_PX,
      y: wa.y + Math.round((wa.height - MINI_WIN_HEIGHT) / 2),
      width: MINI_WIN_WIDTH,
      height: MINI_WIN_HEIGHT
    }
  }
  // full mode 默认位置（右下角 + margin）
  return {
    x: wa.x + wa.width - WIN_WIDTH_COMPACT - MARGIN_FROM_EDGE,
    y: wa.y + wa.height - WIN_HEIGHT - MARGIN_FROM_EDGE,
    width: WIN_WIDTH_COMPACT,
    height: WIN_HEIGHT
  }
}

function setPetMode(mode: PetMode): void {
  if (petMode === mode) return
  if (!petWindow || petWindow.isDestroyed()) return
  petMode = mode
  petWindow.setBounds(computeModeBounds(mode, petWindow.getBounds()))
  if (mode === 'mini') {
    // Mini 时 cursor poll 无意义（eye-following 仅 full mode），强制停
    stopCursorPoll()
  } else {
    // 回 full 后视情况重启 cursor poll（如果 state=idle+activity=idle）
    updateCursorPoll()
  }
  rebuildTrayMenu()
  broadcastPetMode()
  // M9-5b B-1: 持久化 petMode（用户上次退出时是 mini → 下次启动恢复 mini）
  schedulePrefsSave(currentPrefsSnapshot())
}

/**
 * M9-4 (Officer B ⚠️ #3 fix): state-gated cursor poll —— 仅 state=idle &&
 * activity=idle 时启动；其它时刻 stop，避免持续 30Hz IPC 在 non-idle 期间
 * 唤醒 renderer 影响 LLM stream 调度 + 笔记本待机 battery。
 *
 * 调用点：stateMachine.notify (state 变) + activeAppMonitor callback (activity 变)
 * + startup 初始化一次（currentActivity 默认 'idle'）。
 */
function updateCursorPoll(): void {
  // M9-5a Architect B1 fix: 必须加 petMode === 'full' gate。
  // 没有这一层，mini 模式下任何 stateMachine.notify (e.g. scheduleReturnToIdle 把 state
  // 切回 idle) 都会让 30Hz cursor poll IPC **悄悄复活**，跟 mini 模式 stopCursorPoll
  // 承诺直接冲突，prod 跑久了累积无效 IPC.
  const shouldPoll =
    petMode === 'full' &&
    stateMachine.getState() === 'idle' &&
    currentActivity === 'idle'
  if (shouldPoll) {
    startCursorPoll()
  } else {
    stopCursorPoll()
  }
}

// 主进程 = 对话历史 / API key / keyState / model / activity 单一事实来源
const chatHistory: ChatMessage[] = []
// M5-2：跨会话长期记忆 —— pet-memory.md 内容快照，启动时 load，
// remember tool 触发更新时由 IPC handler 重新读盘刷新。注入 system prompt。
let petMemoryCache = ''
// M5-3：用户档案缓存 —— 启动 load，save_user_profile tool / 设置面板编辑后
// 由 onDone 重读刷新。注入 system prompt（setup 模式或正常模式）。
let userProfileCache: UserProfile = { ...DEFAULT_USER_PROFILE }
let currentApiKey: string | null = null
let keyState: KeyState = 'missing'
let currentModel: ModelId = DEFAULT_MODEL
/**
 * M7-3 mirror：当前选定的 SelectedModel（provider + modelId）。
 * 跟 `currentModel: ModelId` 平行存在直到 wave 4 整体切换 —— 当前只 wave 3.x，需要
 * 这个 mirror 让 schedulePrefsSave 不再 hardcode `provider:'anthropic'`。
 *
 * 启动时由 loadPreferences seed；setModel 时同步两者（保持 Anthropic ID 时同步，
 * 切 provider 在 wave 4 通过新 IPC 入口 setSelectedModel 改）。
 */
let currentSelectedModel: SelectedModel = DEFAULT_SELECTED_MODEL
/**
 * M7-4 multi-provider key map：6 个 provider 各自的解密 key（null = 未配置）。
 *
 * 启动时加载（migrateLegacyCredentials 之后 + 跟 loadPreferences 同阶段）。
 * 每个 provider 独立 entry —— 互不影响（任一 key 旋转 / 损坏不连带）。
 *
 * Wave 4.1（本 step）：只填数据，不接 chat:submit；wave 4.2 才让 chat:submit 用
 *   `currentProviderKeys.get(currentSelectedModel.provider)` 取 key + 实例化
 *   LlmClient 替代旧 AnthropicLlmClient。
 *
 * 不暴露明文 key 给 renderer（只 IPC boolean status）。
 */
const currentProviderKeys = new Map<Provider, string | null>()
let llmClient: LlmClient | null = null
// 活动识别（M3-3）：detector 推的状态独立于 PetState，渲染层组合两者决定 SVG
let currentActivity: ActivityState = 'idle'
let followFrontApp = true
// fast-path bundleID regex 白名单是否启用（用户托盘可关 → 走严格 LLM 识别）
let useFastPath = true
// —— M4-A-3 视觉感知（Claude vision pivot） ——
// preferences.visionEnabled 的内存副本 —— 写到 prefs 时同步更新这里
let visionEnabledPref = false
// preferences.visionConsented 的内存副本 —— 用户没 consent 则不允许 enable
let visionConsentedPref = false
// M4-B：当前前台 app 信息 —— current_app_info tool 用
// （activeAppMonitor callback 维护，初始为空）
let currentAppName = ''
let currentAppBundleId = ''
// M4-D：Tavily Search API key —— null = web_search tool 不暴露给 AI
let currentTavilyApiKey: string | null = null

/**
 * 对话轮次令牌 —— 每次 chat:submit 进入时 snapshot 当前值，stream 回调用 snapshot 比对。
 * resetKey() 时 ++ → in-flight stream 的 onChunk/onDone/onError 都会跳过自身，避免：
 *   - 把 assistant turn push 到已被清空的 chatHistory（导致下次 Anthropic 400）
 *   - 推无意义的 chunk/error 给已经在重设引导流的渲染层
 */
let chatTurnToken = 0

/**
 * 当前 in-flight stream 的 abort 句柄。chat:submit 新 turn / resetKey 时调 .abort()
 * 取消上一次 stream，避免白烧 Anthropic token（chatTurnToken 只屏蔽 callback，不停 SDK fetch）。
 */
let currentStreamHandle: StreamHandle | null = null

/**
 * 串行化 credentials 文件 I/O —— resetKey() 的 clearApiKey 与 key:submit 的 saveApiKey
 * 如果并发执行（用户重设后立刻贴新 key），unlink 可能在 writeFile 之后跑，删了刚写的 key。
 * 走一个 promise chain 让两者必然按调用顺序串行。
 */
let credentialOp: Promise<void> = Promise.resolve()
function queueCredentialOp(op: () => Promise<void>): Promise<void> {
  // 前一步失败也不阻塞后一步 —— 不用 then(op, op) 把 op 当 onRejected（行为对但读着费劲），
  // 包一层 lambda 显式表达「无论上一步成功失败都跑下一步」。
  const next = credentialOp.then(op, () => op())
  credentialOp = next
  return next
}

function isWinAlive(): boolean {
  return petWindow !== null && !petWindow.isDestroyed()
}

function notifyKeyState(): void {
  if (isWinAlive()) petWindow!.webContents.send('key:state', keyState)
}

/**
 * 推 vision 配置状态给渲染层 —— 单一事实来源住在主进程。
 * 三态（M4-A-3 pivot 后）：
 *  - disabled-no-consent：用户没勾过隐私 modal，UI 显示"请先同意截图发 Anthropic"
 *  - disabled：consent 给了但 toggle 关 —— UI 显示 toggle off
 *  - enabled：toggle 开，每次发消息会截屏附给 Claude vision
 */
function visionState(): VisionState {
  if (!visionConsentedPref) return { kind: 'disabled-no-consent' }
  return visionEnabledPref ? { kind: 'enabled' } : { kind: 'disabled' }
}

function notifyVisionState(): void {
  if (isWinAlive()) petWindow!.webContents.send('vision:state', visionState())
}

/** Tavily key 状态：暴露 "有 / 无" 给 renderer，绝不暴露真实 key 值。 */
function tavilyState(): TavilyState {
  return currentTavilyApiKey ? { kind: 'configured' } : { kind: 'no-key' }
}

/**
 * Provider key states：所有 provider 的 boolean map（true=配好；false=未配）。
 * 暴露给 renderer 渲染 Settings UI 每张 provider 卡片状态灯，**绝不返回明文 key 值**。
 */
function providerKeyStatesSnapshot(): ProviderKeyStates {
  const result = {} as ProviderKeyStates
  for (const p of PROVIDER_ORDER) {
    result[p] = currentProviderKeys.get(p) != null
  }
  return result
}

function broadcastProviderKeyStates(): void {
  const snapshot = providerKeyStatesSnapshot()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('provider-key:states', snapshot)
  }
}

function broadcastSelectedModelState(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('selected-model:state', currentSelectedModel)
  }
}

/**
 * 从当前内存状态构造完整 Preferences object —— 单一事实来源。
 *
 * 取代各 IPC handler 里"先 await loadPreferences() 再 spread {...prefs, X}"模式
 * （Officer A wave 3.1 observation）：因为 prefs 来自磁盘，但 schedulePrefsSave
 * 200ms debounce 期间 mirror 内存领先磁盘，spread 会把磁盘旧值（如 selectedModel）
 * 写回，覆盖 mirror。直接用 module-scope 内存值消除 race + 省一次磁盘 IO。
 */
function currentPrefsSnapshot(): Preferences {
  return {
    modelId: currentModel,
    selectedModel: currentSelectedModel,
    followFrontApp,
    useFastPath,
    visionEnabled: visionEnabledPref,
    visionConsented: visionConsentedPref,
    petMode
  }
}

function notifyTavilyState(): void {
  if (isWinAlive()) petWindow!.webContents.send('tavily:state', tavilyState())
}

function notifyActivity(): void {
  if (isWinAlive()) petWindow!.webContents.send('pet:activity', currentActivity)
}

/**
 * detector 单例 —— Swift binary 事件驱动 → 拿到 {bundleId, name} → fast-path 或 LLM。
 *
 * 优化策略（M3-3-H 三方会谈）：
 *  1. Swift binary 加固后 emit 真覆盖所有切换场景（didActivate / didLaunch / didHide /
 *     didUnhide / activeSpaceDidChange / didWake）
 *  2. active-app.ts leading + trailing 混合 debounce 让新 app 切换立刻 fire
 *  3. fast-path bundleID 白名单 1ms 命中常见 app（默认开，用户可托盘关）
 *  4. fast-path miss → LLM classify（in-flight dedup + bundleID cache + warmup 后 ~250ms）
 *
 * 无 key 或 classify 失败 → fallback 'idle' 不让桌宠卡在错误状态。
 */
const activeAppMonitor = new ActiveAppMonitor((app) => {
  // M4-B: 同步存当前 app —— current_app_info tool 直接读这两个变量
  currentAppName = app?.name ?? ''
  currentAppBundleId = app?.bundleId ?? ''
  void (async (): Promise<void> => {
    const nextActivity = await resolveActivity(app)
    if (nextActivity === currentActivity) return
    currentActivity = nextActivity
    notifyActivity()
    rebuildTrayMenu()
    // M9-4: activity 变也评估 cursor poll —— 跟随前台 app 切到 coding/etc 时停
    updateCursorPoll()
  })()
})

async function resolveActivity(app: AppIdentity | null): Promise<ActivityState> {
  if (!app) return 'idle'
  // fast-path：bundleID regex 1ms 命中常见 IDE / Terminal / Slack 等
  if (useFastPath) {
    const fast = tryFastPath(app)
    if (fast !== null) return fast
  }
  // 没 key 时 LLM 不可用 → fallback idle
  if (!currentApiKey) return 'idle'
  try {
    return await classifyApp(app, currentApiKey)
  } catch (err) {
    console.warn('[activity] classify threw, fallback idle:', err)
    return 'idle'
  }
}

function setUseFastPath(on: boolean): void {
  if (useFastPath === on) return
  useFastPath = on
  // 切换 fast-path 时清 classifier cache —— 防止 LLM 错误结果污染新策略
  clearClassifyCache()
  rebuildTrayMenu()
  schedulePrefsSave(currentPrefsSnapshot())
}

function setFollowFrontApp(on: boolean): void {
  if (followFrontApp === on) return
  followFrontApp = on
  if (on) {
    activeAppMonitor.start()
  } else {
    activeAppMonitor.stop() // stop 内部会推一次 'idle' 回到闲态
  }
  rebuildTrayMenu()
  schedulePrefsSave(currentPrefsSnapshot())
}

function setKeyInMemory(key: string | null): void {
  currentApiKey = key
  // M7-4: 同步 currentProviderKeys map —— 老 key:submit IPC 走 saveApiKey 写
  // credentials.bin，但 getLlmClient 现在从 currentProviderKeys 取 key 实例化。
  // 不同步的话 user 输完新 key 后这一 session 走老 client（401）直到下次启动 migration。
  // wave 4.4 unify IPC 后 setKeyInMemory 整个删除。
  currentProviderKeys.set('anthropic', key)
  // 重置缓存 client —— 下次 getLlmClient 会用新 key 重建
  llmClient = null
  keyState = key ? 'ready' : 'missing'
  // M7-5: 内嵌 notifyKeyState —— 让每个 setKeyInMemory caller 自动广播 key:state。
  // 之前 wave 4.4 provider-key:submit 走 anthropic 分支调 setKeyInMemory 但**没**调
  // notifyKeyState，App.tsx onKeyState 收不到 'ready'，user 在 Settings 配完
  // Anthropic key 回桌宠仍看到"粘 API key 到这里"placeholder（Officer A 发现）。
  // resetKey / legacy key:submit 也都调 setKeyInMemory，重复 notifyKeyState 无害
  // （webContents.send 幂等）。
  notifyKeyState()
}

/**
 * 拿当前 LlmClient（按 currentSelectedModel.provider/modelId 跟 currentProviderKeys
 * 派生）。currentProviderKeys map 里对应 provider 没 key → null（chat:submit 走
 * 'no-api-key' error）。Cached 直到 setKeyInMemory/setModel/setSelectedModel
 * 把 llmClient = null 让下次重建。
 */
function getLlmClient(): LlmClient | null {
  if (llmClient) return llmClient
  const apiKey = currentProviderKeys.get(currentSelectedModel.provider)
  if (!apiKey) return null
  const model = instantiateModelSync(
    currentSelectedModel.provider,
    apiKey,
    currentSelectedModel.modelId
  )
  llmClient = new LlmClient(model)
  return llmClient
}

/**
 * Debounced 持久化偏好 —— 用户连切几个模型时只写最后一次到磁盘，避免 fs.writeFile
 * race（并发 writeFile 到同 path 完成顺序不保证）+ 减少 I/O。
 *
 * 200ms 是经验值：用户从点开 submenu 到放手不会超过 200ms；下次切换会 reset timer。
 * 边缘：debounce 中 quit app 这一次切换没落盘 —— 下次启动 menu 看到的是上次的值，
 * 用户能立刻再切，是可接受的退化（vs 把 before-quit 改成同步 flush 增加复杂度）。
 */
let prefsSaveTimer: NodeJS.Timeout | null = null
let pendingPrefs: Preferences | null = null
function schedulePrefsSave(prefs: Preferences): void {
  pendingPrefs = prefs
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer)
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null
    const toSave = pendingPrefs
    pendingPrefs = null
    if (toSave) {
      void savePreferences(toSave).catch((err) => console.error('[prefs] save failed:', err))
    }
  }, 200)
}

/**
 * 切换模型：
 *  - 如果有 in-flight stream，必须清理三件事，否则状态卡死：
 *    1. send chat:done 给 renderer → streaming 气泡的 cursor-blink 停下
 *    2. pop chatHistory 末尾的 user turn → 下次 messages 不会以 [user, user, ...] 起头
 *    3. transition idle（受 thinking minMs 保护时用 scheduleReturnToIdle 兜底）
 *       → 桌宠 SVG 不卡在 thinking
 *  - 然后才更新内存 + abort SDK fetch + chatTurnToken++ 让旧 callback 自我屏蔽
 *  - 重建托盘 menu 让 radio checked 反映新选项 + debounced 落盘
 */
function setModel(id: ModelId): void {
  if (currentModel === id) return

  if (currentStreamHandle) {
    if (isWinAlive()) {
      petWindow!.webContents.send('chat:done', { inputTokens: 0, outputTokens: 0 })
    }
    if (chatHistory[chatHistory.length - 1]?.role === 'user') {
      chatHistory.pop()
    }
    if (!stateMachine.transition('idle')) {
      stateMachine.scheduleReturnToIdle(PET_STATES.thinking.minMs)
    }
  }

  currentModel = id
  // M7-3: setModel 仍只接 ModelId（单 Anthropic 时代 API），同步更新 mirror 保持
  // 一致 —— 这一路径用户只能从 Anthropic 三个 model 间切（tray menu），所以
  // selectedModel 一定是 anthropic + id。Wave 4 新增 setSelectedModel 入口才能
  // 切到别的 provider。
  currentSelectedModel = { provider: 'anthropic', modelId: id }
  llmClient = null
  currentStreamHandle?.abort()
  currentStreamHandle = null
  chatTurnToken++
  rebuildTrayMenu()
  schedulePrefsSave(currentPrefsSnapshot())
}

function trimChatHistory(): void {
  const limit = MAX_HISTORY_PAIRS * 2
  if (chatHistory.length > limit) {
    chatHistory.splice(0, chatHistory.length - limit)
  }
}

// M5-2：debounce 对话历史落盘 —— 连续 chat:done 时合并 500ms 内的写入
let chatHistorySaveTimer: NodeJS.Timeout | null = null
function scheduleChatHistorySave(): void {
  if (chatHistorySaveTimer) clearTimeout(chatHistorySaveTimer)
  chatHistorySaveTimer = setTimeout(() => {
    chatHistorySaveTimer = null
    void saveChatHistory(chatHistory)
  }, 500)
}

// M5-2：重读 pet-memory.md 刷新 system prompt 注入缓存
async function refreshPetMemory(): Promise<void> {
  try {
    petMemoryCache = await loadMemory()
  } catch (err) {
    console.warn('[pet-memory] refresh failed:', err)
  }
}

// M5-3：重读 user-profile.json 刷新 system prompt 注入缓存
async function refreshUserProfile(): Promise<void> {
  try {
    userProfileCache = await loadUserProfile()
    // 推给所有窗口（设置面板订阅了）
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('user-profile:state', userProfileCache)
    }
  } catch (err) {
    console.warn('[user-profile] refresh failed:', err)
  }
}

/**
 * Anthropic key env var 后门（dev 用）—— 让本地调试不用反复粘 key 到 UI。
 *
 * Wave 4.3: 原本在 anthropic.ts（已删）。inline 到这里因为只有 resolveStartupKey
 * 一处用 + 是 Anthropic 单 provider 时代遗留 helper。Wave 4.4 unify provider key
 * API 后会被 provider-keys.ts 的 getProviderKeyFromEnv('anthropic') 取代。
 */
function getApiKeyFromEnv(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY?.trim()
  return raw && raw.length > 0 ? raw : null
}

/** 粗判一段文本是不是 Anthropic key。 */
function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,200}$/.test(text.trim())
}

/**
 * 启动时解析 key：env 优先（开发后门），其次解密文件。
 * env 来的 key 不写入加密文件 —— 让 env 永远是唯一开发覆盖渠道。
 *
 * env 格式不像 Anthropic key 时跳过 —— 否则会进入 ready 状态发请求触发 401 → resetKey
 * 清磁盘 → 下次启动 env 仍在又被读上来 → 死循环走 invalid-api-key 而非引导流。
 */
async function resolveStartupKey(): Promise<void> {
  const fromEnv = getApiKeyFromEnv()
  if (fromEnv && looksLikeApiKey(fromEnv)) {
    setKeyInMemory(fromEnv)
    return
  }
  if (fromEnv) {
    console.warn(
      '[startup] ANTHROPIC_API_KEY env 格式不像 Anthropic key，忽略，走加密文件 / missing'
    )
  }
  // M7-4: 改用 currentProviderKeys map（启动时已经由 resolveProviderKey 加载）
  // 而非旧 loadApiKey()。原因：migrateLegacyCredentials() 跑过后 credentials.bin
  // 已经被搬到 anthropic-key.bin + unlink 老文件 —— loadApiKey 读旧文件名永远 ENOENT。
  // map 已经覆盖 env + 老 credentials.bin（被 migration 搬过）+ 新 anthropic-key.bin
  // 三个来源，是正确的 single source。
  // 注意：调用方必须保证 currentProviderKeys 已经被填充（启动序列里 for-loop 之后）。
  const fromDisk = currentProviderKeys.get('anthropic') ?? null
  setKeyInMemory(fromDisk)
}

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let visibilityWatchdog: NodeJS.Timeout | null = null
const stateMachine = new PetStateMachine((state) => {
  if (isWinAlive()) petWindow!.webContents.send('pet:state', state)
  // M9-4: state 变即评估是否启停 cursor poll（idle 进入开，离开关）
  updateCursorPoll()
})

function reapplyMacVisibility(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (process.platform !== 'darwin') return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

function startVisibilityWatchdog(): void {
  if (visibilityWatchdog) return
  visibilityWatchdog = setInterval(() => {
    reapplyMacVisibility(petWindow)
  }, VISIBILITY_WATCHDOG_MS)
}

function stopVisibilityWatchdog(): void {
  if (visibilityWatchdog) {
    clearInterval(visibilityWatchdog)
    visibilityWatchdog = null
  }
}

// 之前有 cursorWatcher 用 screen.getCursorScreenPoint 100ms polling 切 ignoreMouseEvents
// —— 已删除：normal BrowserWindow（非 NSPanel）默认接 click，polling 反而引入 100ms 延迟
// 让快速 click 失败。trade-off 用 always-接-mouse 换 click 可靠性。
// 相关的 isDraggingPet / dragInactivityTimer 也都一并删 —— 没人读，只是为 cursorWatcher
// 在 drag 期间暂停切 ignoreMouse 而设。

function setChatOpen(open: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  // M9-5a Officer C #1 fix: mini 模式时打开 chat 必须先回 full，否则 setBounds(width=540)
  // 用 mini panel 当前的右边缘位置（x ≈ workArea.right - 24）→ 540 宽往右扯 → 把
  // chat 框炸到屏外 470px，用户看到一条无 chat input 的窗口卡在屏右缝里。
  // 走 setPetMode('full') 先把窗口 setBounds 到右下角默认位置，下面 chat resize 才能正确算 newX。
  // 关闭路径在 mini 下无意义（mini 不显示 chat DOM）→ silently bail。
  if (petMode === 'mini') {
    if (!open) return
    setPetMode('full')
  }
  const newW = open ? WIN_WIDTH_FULL : WIN_WIDTH_COMPACT
  const [oldW] = petWindow.getSize()
  if (oldW === newW) return

  const [x, y] = petWindow.getPosition()
  const display = screen.getDisplayMatching({ x, y, width: oldW, height: WIN_HEIGHT })
  const { workArea } = display

  const centerX = x + oldW / 2
  const screenCenterX = workArea.x + workArea.width / 2
  const expandsLeft = centerX > screenCenterX

  let newX: number
  if (open) {
    newX = expandsLeft ? x + (oldW - newW) : x
  } else {
    newX = expandsLeft ? x + (oldW - newW) : x
  }

  const minX = workArea.x
  const maxX = workArea.x + workArea.width - newW
  newX = Math.max(minX, Math.min(newX, maxX))

  petWindow.setBounds({ x: newX, y, width: newW, height: WIN_HEIGHT }, true)
  reapplyMacVisibility(petWindow)

  if (open) {
    setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('chat:window-ready')
      }
    }, WINDOW_RESIZE_ANIM_MS)
  }
}

function createPetWindow(): void {
  const { workArea } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    width: WIN_WIDTH_COMPACT,
    height: WIN_HEIGHT,
    x: workArea.x + workArea.width - WIN_WIDTH_COMPACT - MARGIN_FROM_EDGE,
    y: workArea.y + workArea.height - WIN_HEIGHT - MARGIN_FROM_EDGE,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    // 不用 type:'panel' —— NSPanel non-activating 在别的 app (VS Code) 前台时不接 keyboard
    // 路由，input 字符进不去。改 normal BrowserWindow 让 click 桌宠时 DeskPet 抢前台
    // (VS Code 短暂失焦)，trade-off 换 input/keyboard 能用。LSUIElement=true 已保证不进
    // dock + Cmd-Tab；setVisibleOnAllWorkspaces 单独处理跨 space / fullscreen。
    focusable: process.platform !== 'linux',
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // prod 关 devtools：F12 / ⌥⌘I 拿不到 IPC 监控面板，避免 submitKey 明文 key 被嗅探
      devTools: is.dev
    }
  })

  petWindow = win
  win.on('closed', () => {
    if (petWindow === win) petWindow = null
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('pet:state', stateMachine.getState())
    win.webContents.send('key:state', keyState)
    win.webContents.send('pet:activity', currentActivity)
    win.webContents.send('vision:state', visionState())
    win.webContents.send('tavily:state', tavilyState())
  })

  win.on('ready-to-show', () => {
    win.show()
    // 不设 setIgnoreMouseEvents(true) —— 默认 false 让 panel 永久接 click。
    // 之前的 cursor polling 方案有 100ms 延迟：用户快速 click 时 polling 还没 fire，
    // mousedown 被穿透到底层 app → "点桌宠没对话框"。trade-off：透明区域 click 也被
    // panel 接管不再穿透到底层 app（少见 use case，远比 click 失败严重轻）。
    reapplyMacVisibility(win)
    startVisibilityWatchdog()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function togglePetVisibility(): void {
  if (!petWindow) return
  if (petWindow.isVisible()) petWindow.hide()
  else {
    petWindow.show()
    reapplyMacVisibility(petWindow)
  }
}

function ensurePetVisible(): void {
  if (!petWindow) return
  if (!petWindow.isVisible()) {
    petWindow.show()
    reapplyMacVisibility(petWindow)
  }
}

function resetPetPosition(): void {
  if (!petWindow) return
  const { workArea } = screen.getPrimaryDisplay()
  const [w] = petWindow.getSize()
  petWindow.setPosition(
    workArea.x + workArea.width - w - MARGIN_FROM_EDGE,
    workArea.y + workArea.height - WIN_HEIGHT - MARGIN_FROM_EDGE
  )
}

/**
 * 托盘 / IPC 主动重设 key：清存盘 + 清内存 + 清对话上下文 + 推送 missing + 确保窗口可见。
 *
 * 先做内存 / 状态推送（同步），让任何并发 chat:submit 立刻看到 keyState=missing；
 * 自增 chatTurnToken 让任何 in-flight stream 的回调自我跳过；
 * 磁盘 unlink 通过 queueCredentialOp 串行 —— 保证不会跑在后续 saveApiKey 之后。
 *
 * 对话历史一并清掉 —— key 换了等于换账户视角，旧上下文不带过去（且涉及隐私）。
 * env var 来的 key 也会被清磁盘 —— 但 env 仍在，下次启动 resolveStartupKey 会再读上来。
 */
async function resetKey(): Promise<void> {
  // 先 abort 任何 in-flight stream：chatTurnToken 只屏蔽 callback，真正的 fetch 还在跑会烧 token
  currentStreamHandle?.abort()
  currentStreamHandle = null
  setKeyInMemory(null)
  chatHistory.length = 0
  chatTurnToken++
  // Wave 6 follow-up (Officer A 💡): 跟非-anthropic provider-key:reset 分支对称推
  // 3 个状态恢复 event 让 renderer UI 看到一致行为（之前 anthropic resetKey 只靠
  // chatTurnToken++ 屏蔽 callback，renderer 看不到 chat:done 可能挂 "thinking"）
  if (isWinAlive()) {
    petWindow!.webContents.send('chat:done', { inputTokens: 0, outputTokens: 0 })
    petWindow!.webContents.send('chat:history-cleared')
  }
  if (!stateMachine.transition('idle')) {
    stateMachine.scheduleReturnToIdle(PET_STATES.thinking.minMs)
  }
  // cr B1: classifier cache 跨 key 身份不该残留 —— 上一个 key 用 LLM 分类出来的结果可能
  // 是错的（Anthropic 偶发抽风），如果不清，重设 key 后那个错误分类会永久命中缓存
  clearClassifyCache()
  ensurePetVisible()
  notifyKeyState()
  broadcastProviderKeyStates()
  // M7-4 wave 4.4: 切到 clearProviderKey('anthropic') 写新格式 anthropic-key.bin。
  // 老 clearApiKey() 写 credentials.bin，但 credentials.bin 在 wave 4 启动 migration
  // 已经被搬走，新值都进 anthropic-key.bin 了 —— 这里直接清新文件。
  await queueCredentialOp(async () => {
    try {
      await clearProviderKey('anthropic')
    } catch (err) {
      console.error('[resetKey] clearProviderKey failed:', err)
    }
  })
}

/**
 * 构造托盘菜单 —— 抽出来是为了 setModel / 状态变化时重建 menu 让 radio 反映最新 checked。
 * Electron MenuItem 不 reactive：改 currentModel 不会自动更新 menu 的 checked 标记，
 * 只能整菜单重建。setContextMenu 是廉价操作（O(item count)），可以放心多调。
 */
function buildTrayMenu(): Menu {
  const activityInfo = ACTIVITY_INFO[currentActivity]
  const activityLabel = followFrontApp
    ? `当前活动：${activityInfo.emoji} ${activityInfo.label}`
    : '当前活动：（未跟随）'

  return Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏桌宠',
      accelerator: 'CmdOrCtrl+Shift+P',
      click: togglePetVisibility
    },
    { label: '重置位置（右下角）', click: resetPetPosition },
    {
      // M9-5a 极简模式 toggle
      label: '极简模式（藏屏幕边缘）',
      type: 'checkbox',
      checked: petMode === 'mini',
      click: (item) => setPetMode(item.checked ? 'mini' : 'full')
    },
    { type: 'separator' },
    { label: activityLabel, enabled: false }, // readonly 状态显示
    {
      label: '跟随前台 App',
      type: 'checkbox',
      checked: followFrontApp,
      click: (item) => setFollowFrontApp(item.checked)
    },
    {
      label: '严格 LLM 识别（关 fast-path）',
      type: 'checkbox',
      checked: !useFastPath,
      enabled: followFrontApp,
      click: (item) => setUseFastPath(!item.checked)
    },
    { type: 'separator' },
    {
      label: '设置…',
      accelerator: 'CmdOrCtrl+,',
      click: () => createSettingsWindow()
    },
    { label: '重设 API Key…', click: () => void resetKey() },
    {
      label: '模型',
      submenu: AVAILABLE_MODELS.map((m) => ({
        label: m.label,
        type: 'radio' as const,
        checked: currentModel === m.id,
        click: () => setModel(m.id)
      }))
    },
    { type: 'separator' },
    {
      label: 'Demo: 思考 → 庆祝 → 待机',
      click: () => stateMachine.demoCycle()
    },
    { type: 'separator' },
    {
      label: '退出 DeskPet',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit()
    }
  ])
}

function rebuildTrayMenu(): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu())
  }
}

function createTray(): void {
  // LSUIElement=true 让 app 不在 Dock 也不在 ⌘-Tab —— tray 创建失败就找不到地方 quit。
  // try/catch 兜底：失败时 console.error，至少 main 进程没崩，用户能 killall。
  try {
    let image = nativeImage.createFromPath(trayIconPath)
    if (process.platform === 'darwin') {
      image = image.resize({ width: 18, height: 18 })
    }
    tray = new Tray(image)
  } catch (err) {
    console.error('[tray] 创建失败，app 仍在跑但没有 tray 入口：', err)
    return
  }
  tray.setToolTip('DeskPet 桌宠')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', togglePetVisibility)
}

function registerIpc(): void {
  // —— M9-2 click reactions —— react to user double/quad click on pet body
  ipcMain.on('pet:poke', () => {
    if (stateMachine.transition('poked')) {
      stateMachine.scheduleReturnToIdle(PET_STATES.poked.minMs)
    }
  })

  ipcMain.on('pet:startled', () => {
    if (stateMachine.transition('looking_around')) {
      stateMachine.scheduleReturnToIdle(PET_STATES.looking_around.minMs)
    }
  })

  // M9-3 fix: 单击 / pointerdown 时立即 wake from sleep chain（cursorWatcher 已删
  // 后没 hover-wake 路径，user 直接点 sleeping pet 之前没反应）
  ipcMain.on('pet:wake', () => {
    stateMachine.wakeFromSleep()
  })

  ipcMain.on('window:move-delta', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
    // M8: 拖拽 pet = user 主动 interaction → wake from sleep
    stateMachine.wakeFromSleep()
  })

  // —— M9-5a Pet mode IPC（mini ↔ full 切换 + snap-to-edge detection）——

  ipcMain.on('pet:set-mode', (_event, rawMode: unknown) => {
    if (typeof rawMode !== 'string' || !isPetMode(rawMode)) {
      console.warn('[pet:set-mode] invalid mode, ignored:', rawMode)
      return
    }
    setPetMode(rawMode)
  })

  ipcMain.on('pet:request-mode-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('pet:mode', petMode)
  })

  /**
   * M9-5a: drag 结束时 renderer 发 'window:drag-end'，main 检测 panel 当前位置
   * 是否离右边 workArea.right 在 MINI_SNAP_THRESHOLD_PX (40px) 内 →
   * 触发 setPetMode('mini')。
   *
   * 在 main 做 snap 判定的原因：renderer 只跟 dx/dy delta，main 才知道绝对
   * window position。drag 通过 window:move-delta 累计 setPosition，最终位置
   * = win.getPosition()。
   */
  ipcMain.on('window:drag-end', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (petMode === 'mini') return // 已经 mini，drag 在 mini 内不重新 snap
    const bounds = petWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const wa = display.workArea
    const rightEdge = bounds.x + bounds.width
    if (rightEdge >= wa.x + wa.width - MINI_SNAP_THRESHOLD_PX) {
      setPetMode('mini')
    }
  })

  ipcMain.on('window:ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
    reapplyMacVisibility(win)
    // M8: 鼠标移入 pet 实体（ignore=false）= 想互动 → wake
    if (!ignore) stateMachine.wakeFromSleep()
  })

  // 渲染层提交 key —— 主进程校验 + 加密存盘 + 切 ready + 广播
  ipcMain.on('key:submit', async (_event, rawKey: string) => {
    const key = String(rawKey ?? '').trim()
    if (!looksLikeApiKey(key)) {
      // cr W1: main 端比 renderer 严（200 字符上限）—— renderer 通过但 main 拒时
      // 必须给 renderer 反馈，否则用户看到「🔑 已提交」气泡但 keyState 永不变 ready
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:error', { kind: 'key-format-invalid' })
      }
      return
    }
    // 串行化：避免与任何 in-flight resetKey 的 clearProviderKey 撞车
    let persisted = true
    await queueCredentialOp(async () => {
      try {
        // M7-4 wave 4.4: 直接写新格式 anthropic-key.bin（取代旧 saveApiKey 写 credentials.bin），
        // 避免 migration 在下次启动碰到 credentials.bin + anthropic-key.bin 共存 + 旧 newPath
        // 赢的 bug（Officer B wave 4.1 observation）。
        await saveProviderKey('anthropic', key)
      } catch (err) {
        console.error('[key:submit] saveProviderKey failed:', err)
        persisted = false
      }
    })
    setKeyInMemory(key)
    notifyKeyState()
    if (!persisted && isWinAlive()) {
      // safeStorage 不可用（典型场景 Linux 无 keyring）—— 内存里仍可用但下次启动会丢
      petWindow!.webContents.send('chat:error', { kind: 'key-not-persisted' })
    }
  })

  ipcMain.on('key:reset', () => {
    void resetKey()
  })

  // 渲染层挂载完后主动 ping，让主进程补推一次当前 keyState。
  // —— M4-A-3 vision IPC handlers（pivot 后 token-based → consent-based） ——
  /** 用户在隐私 modal 点了 "我已了解，启用"：consent + enable 一并写入 */
  ipcMain.on('vision:accept-consent-and-enable', async () => {
    visionConsentedPref = true
    visionEnabledPref = true
    notifyVisionState()
    try {
      // M7-4 wave 4.5: 用 currentPrefsSnapshot 替代 loadPreferences + spread
      // ——消除 200ms debounce 窗口内磁盘旧值覆盖 mirror 新值的 race。
      await savePreferences(currentPrefsSnapshot())
    } catch (err) {
      console.warn('[vision:accept-consent-and-enable] savePreferences failed:', err)
    }
  })

  ipcMain.on('vision:set-enabled', async (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') return
    // 没 consent 不允许启用
    if (enabled && !visionConsentedPref) {
      notifyVisionState()
      return
    }
    visionEnabledPref = enabled
    notifyVisionState()
    try {
      await savePreferences(currentPrefsSnapshot())
    } catch (err) {
      console.warn('[vision:set-enabled] savePreferences failed:', err)
    }
  })

  /** 撤销 consent —— 关掉功能 + 清掉 consent flag，下次开需要重看 modal */
  ipcMain.on('vision:revoke-consent', async () => {
    visionConsentedPref = false
    visionEnabledPref = false
    notifyVisionState()
    try {
      await savePreferences(currentPrefsSnapshot())
    } catch (err) {
      console.warn('[vision:revoke-consent] savePreferences failed:', err)
    }
  })

  ipcMain.on('vision:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('vision:state', visionState())
  })

  // —— M4-D-1 Tavily key IPC handlers ——
  ipcMain.on('tavily:submit-key', async (_event, rawKey: string) => {
    const key = String(rawKey).slice(0, 512).trim()
    if (!key) return
    try {
      await saveTavilyKey(key)
      currentTavilyApiKey = key
      notifyTavilyState()
    } catch (err) {
      console.error('[tavily:submit-key] saveTavilyKey failed:', err)
      // 落盘失败也放内存，本 session 仍可用 —— 重启会丢
      currentTavilyApiKey = key
      notifyTavilyState()
    }
  })

  ipcMain.on('tavily:reset-key', async () => {
    try {
      await clearTavilyKey()
    } catch (err) {
      console.warn('[tavily:reset-key] clearTavilyKey failed:', err)
    }
    currentTavilyApiKey = null
    notifyTavilyState()
  })

  ipcMain.on('tavily:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('tavily:state', tavilyState())
  })

  // —— M7-4 multi-provider key + selected-model IPC ——

  ipcMain.on(
    'provider-key:submit',
    async (event, rawProvider: unknown, rawKey: unknown) => {
      if (!isValidProvider(rawProvider)) {
        console.warn('[provider-key:submit] invalid provider, ignored:', rawProvider)
        return
      }
      const key = String(rawKey ?? '').trim()
      if (!key) {
        console.warn(`[provider-key:submit] empty key for ${rawProvider}, ignored`)
        return
      }
      let persisted = true
      await queueCredentialOp(async () => {
        try {
          await saveProviderKey(rawProvider, key)
        } catch (err) {
          console.error(`[provider-key:submit] saveProviderKey(${rawProvider}) failed:`, err)
          persisted = false
        }
      })
      if (!persisted) {
        const win = BrowserWindow.fromWebContents(event.sender)
        win?.webContents.send('chat:error', { kind: 'key-not-persisted' })
        return
      }
      // anthropic 走 legacy setKeyInMemory（内部同步 map + 重置 llmClient + notifyKeyState）；
      // 其它 provider 直接 set map + invalidate llmClient（当前选才需要）。
      // 不重复 set map 的同一 key。
      if (rawProvider === 'anthropic') {
        setKeyInMemory(key)
      } else {
        currentProviderKeys.set(rawProvider, key)
        if (rawProvider === currentSelectedModel.provider) {
          llmClient = null
        }
      }
      broadcastProviderKeyStates()
    }
  )

  ipcMain.on('provider-key:reset', async (_event, rawProvider: unknown) => {
    if (!isValidProvider(rawProvider)) {
      console.warn('[provider-key:reset] invalid provider, ignored:', rawProvider)
      return
    }
    // anthropic 走 legacy resetKey（内部已含 clearProviderKey + abort stream +
    // chatHistory clear + classifier cache clear + keyState notify +
    // broadcastProviderKeyStates）—— await 让 handler 返回后状态已完整 settle，
    // 不重复跑 clearProviderKey 也不双 broadcast。
    if (rawProvider === 'anthropic') {
      await resetKey()
      return
    }
    // 非 anthropic：跟 anthropic resetKey 对称的 side effect（Officer B wave 5
    // follow-up）—— 仅当 reset 的是 currentSelectedModel.provider 时才中断当前
    // 对话：abort in-flight stream（防 user 切 OpenAI 烧 token 中点 reset 还继续）
    // + 清 chatHistory（identity reset 语义） + bubble UI 复位。不清 classifier
    // cache（classifier 用 Anthropic Haiku，跟此 provider 无关）。
    if (rawProvider === currentSelectedModel.provider) {
      currentStreamHandle?.abort()
      currentStreamHandle = null
      chatTurnToken++
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:done', { inputTokens: 0, outputTokens: 0 })
      }
      chatHistory.length = 0
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:history-cleared')
      }
      if (!stateMachine.transition('idle')) {
        stateMachine.scheduleReturnToIdle(PET_STATES.thinking.minMs)
      }
    }
    await queueCredentialOp(async () => {
      try {
        await clearProviderKey(rawProvider)
      } catch (err) {
        console.error(`[provider-key:reset] clearProviderKey(${rawProvider}) failed:`, err)
      }
    })
    currentProviderKeys.set(rawProvider, null)
    if (rawProvider === currentSelectedModel.provider) {
      llmClient = null
    }
    broadcastProviderKeyStates()
  })

  ipcMain.on('provider-key:request-states', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('provider-key:states', providerKeyStatesSnapshot())
  })

  ipcMain.on('selected-model:set', (_event, rawSel: unknown) => {
    if (!isValidSelectedModel(rawSel)) {
      console.warn('[selected-model:set] invalid input, ignored:', rawSel)
      return
    }
    if (
      currentSelectedModel.provider === rawSel.provider &&
      currentSelectedModel.modelId === rawSel.modelId
    ) {
      return // no-op
    }
    const isProviderSwitch = currentSelectedModel.provider !== rawSel.provider

    // 切换前清理 in-flight stream + UI bubble + drop trailing user msg
    if (currentStreamHandle) {
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:done', { inputTokens: 0, outputTokens: 0 })
      }
      if (chatHistory[chatHistory.length - 1]?.role === 'user') {
        chatHistory.pop()
      }
      if (!stateMachine.transition('idle')) {
        stateMachine.scheduleReturnToIdle(PET_STATES.thinking.minMs)
      }
    }
    currentStreamHandle?.abort()
    currentStreamHandle = null
    chatTurnToken++

    currentSelectedModel = rawSel
    // Anthropic 时 legacy currentModel 跟 currentSelectedModel.modelId 对齐
    if (rawSel.provider === 'anthropic' && isValidModelId(rawSel.modelId)) {
      currentModel = rawSel.modelId
    }

    // Cross-provider switch：tool_use_id 跨 provider 不兼容 → 自动 new conversation
    if (isProviderSwitch) {
      chatHistory.length = 0
      scheduleChatHistorySave()
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:history-cleared')
      }
    }

    llmClient = null
    rebuildTrayMenu()
    schedulePrefsSave(currentPrefsSnapshot())
    broadcastSelectedModelState()
  })

  ipcMain.on('selected-model:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('selected-model:state', currentSelectedModel)
  })

  // —— M5 settings panel IPC ——

  /** Preferences 完整 state（modelId / followFrontApp / useFastPath / vision*）—— 设置面板 + 主窗口都订阅 */
  const prefsSnapshot = (): {
    modelId: ModelId
    followFrontApp: boolean
    useFastPath: boolean
    visionEnabled: boolean
    visionConsented: boolean
  } => ({
    modelId: currentModel,
    followFrontApp,
    useFastPath,
    visionEnabled: visionEnabledPref,
    visionConsented: visionConsentedPref
  })

  function broadcastPrefsState(): void {
    const snapshot = prefsSnapshot()
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('prefs:state', snapshot)
    }
  }

  ipcMain.on('prefs:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('prefs:state', prefsSnapshot())
  })

  ipcMain.on('prefs:set-model', (_event, modelId: unknown) => {
    if (!isValidModelId(modelId)) return
    setModel(modelId)
    broadcastPrefsState()
  })

  ipcMain.on('prefs:set-follow-front-app', (_event, value: unknown) => {
    if (typeof value !== 'boolean') return
    setFollowFrontApp(value)
    broadcastPrefsState()
  })

  ipcMain.on('prefs:set-use-fast-path', (_event, value: unknown) => {
    if (typeof value !== 'boolean') return
    setUseFastPath(value)
    broadcastPrefsState()
  })

  // —— Audit log ——
  ipcMain.on('audit:reveal-in-finder', () => {
    void shell.showItemInFolder(auditLogPath())
  })

  ipcMain.handle('audit:clear', async () => {
    try {
      await clearAuditLog()
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  })

  // —— Trusted dirs ——
  function broadcastTrustedDirsState(): void {
    const snapshot = getTrustedDirsSnapshot()
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('trusted-dirs:state', snapshot)
    }
  }

  ipcMain.on('trusted-dirs:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('trusted-dirs:state', getTrustedDirsSnapshot())
  })

  ipcMain.handle('trusted-dirs:revoke-persistent', async (_event, dir: unknown) => {
    if (typeof dir !== 'string') return { ok: false, error: 'dir must be string' }
    await revokePersistentTrust(dir)
    broadcastTrustedDirsState()
    return { ok: true }
  })

  ipcMain.on('trusted-dirs:revoke-all-session', () => {
    revokeAllSessionTrust()
    broadcastTrustedDirsState()
  })

  // —— M5-2 跨会话记忆 IPC ——
  ipcMain.handle('memory:read', async () => {
    try {
      const content = await loadMemory()
      return { ok: true as const, content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('memory:clear', async () => {
    try {
      await clearMemory()
      petMemoryCache = ''
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('memory:save', async (_event, content: unknown) => {
    if (typeof content !== 'string') {
      return { ok: false as const, error: 'content must be string' }
    }
    try {
      await setMemory(content)
      petMemoryCache = content
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.on('memory:reveal-in-finder', () => {
    void shell.showItemInFolder(petMemoryPath())
  })

  ipcMain.handle('chat-history:clear', async () => {
    try {
      await clearChatHistory()
      chatHistory.length = 0
      // 通知 renderer 重置消息 UI
      if (isWinAlive()) petWindow!.webContents.send('chat:history-cleared')
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.on('chat-history:reveal-in-finder', () => {
    void shell.showItemInFolder(chatHistoryPath())
  })

  // —— M5-3 用户档案 IPC ——
  ipcMain.on('user-profile:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('user-profile:state', userProfileCache)
  })

  ipcMain.handle('user-profile:save', async (_event, profile: unknown) => {
    if (!profile || typeof profile !== 'object') {
      return { ok: false as const, error: 'profile must be object' }
    }
    const p = profile as Partial<UserProfile>
    // 用现有 cache 做 fallback，让 settings UI 允许部分字段更新
    const merged: UserProfile = {
      name: typeof p.name === 'string' ? p.name : userProfileCache.name,
      about: typeof p.about === 'string' ? p.about : userProfileCache.about,
      personaPreset:
        typeof p.personaPreset === 'string'
          ? (p.personaPreset as UserProfile['personaPreset'])
          : userProfileCache.personaPreset,
      personaCustom:
        typeof p.personaCustom === 'string' ? p.personaCustom : userProfileCache.personaCustom,
      setupCompleted:
        typeof p.setupCompleted === 'boolean' ? p.setupCompleted : userProfileCache.setupCompleted
    }
    try {
      await saveUserProfile(merged)
      userProfileCache = merged
      // 推给所有 windows
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('user-profile:state', userProfileCache)
      }
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('user-profile:reset-setup', async () => {
    try {
      userProfileCache = await resetUserProfileSetup()
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('user-profile:state', userProfileCache)
      }
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.on('user-profile:reveal-in-finder', () => {
    void shell.showItemInFolder(userProfilePath())
  })

  // —— 设置面板 open（菜单 / 快捷键以外的入口） ——
  ipcMain.on('settings:open', () => {
    createSettingsWindow()
  })

  // 防御启动竞态：did-finish-load 推 'key:state' 时若 React useEffect 还没装好 listener
  // 会丢掉，桌宠就永远不开口。renderer 收到响应后才知道自己是 missing 还是 ready。
  ipcMain.on('key:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('key:state', keyState)
  })

  ipcMain.on('chat:submit', async (event, text: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const cleaned = String(text).slice(0, 2000).trim()
    if (!cleaned) return

    const client = getLlmClient()
    if (!client) {
      // missing 状态兜底：渲染层应当走 key:submit，不该走到这里
      win.webContents.send('chat:error', { kind: 'no-api-key' })
      return
    }

    // 上一个 stream 还在跑就 abort（用户连点 submit 时不烧两份 token）
    currentStreamHandle?.abort()

    // —— M4-B/C/D agentic tools —— M7-4 切 AI SDK ToolSet：
    // chat:submit 只准备 toolCtx，LlmClient 内部用 buildToolSetForContext(ctx)
    // 把 tool 池跟每个 tool 的 execute 函数自动包装好；SDK 跑 tool loop。
    // tools 池由 ToolContext 动态构建（如 tavilyApiKey 缺则 web_search 不暴露）。
    const agenticEnabled = visionEnabledPref && visionConsentedPref
    const toolCtx = {
      petWindow,
      currentActivity,
      currentAppName,
      currentAppBundleId,
      tavilyApiKey: currentTavilyApiKey,
      // M7-6 wave 6 + M8 hotfix: 让 tool-defs.ts 据此 inject 当前 model 的
      // native tool。改传 full SelectedModel（不只 provider）让 specialized-tools
      // 据 modelId gate —— Haiku 4.5 不在 anthropic codeExecution_20260120 +
      // webSearch_20260209 supported model list 里，装上会让 API 拒绝整个请求
      // → 0 step → "No output generated" SDK 错（M8 实测）。
      selectedModel: currentSelectedModel,
      // M8 set_pet_animation: AI 调 tool → stateMachine.transition 到对应动画
      // state，scheduleReturnToIdle 让动画播完一个 GIF cycle 自动回 idle。
      // minMs + fade buffer：renderer 切 GIF 走 cross-fade 占用 minMs 起始的
      // 280ms（FADE_HALF_MS），不补上的话动画实际可见周期短一帧。
      // 返回 boolean 让 executor 知道是否被 minMs 保护吞 → tool_result is_error。
      setPetAnimation: (name: PetAnimation): boolean => {
        const transitioned = stateMachine.transition(name)
        if (transitioned) {
          stateMachine.scheduleReturnToIdle(PET_STATES[name].minMs + RENDERER_FADE_HALF_MS)
        }
        return transitioned
      },
      // M8 让 AI 知道自己当前在干什么（"pet 要知道自己现在是什么状态"）
      currentPetState: stateMachine.getState()
    }

    chatHistory.push({ role: 'user', content: cleaned })
    trimChatHistory()
    stateMachine.transition('thinking')

    const myToken = ++chatTurnToken
    let aiText = ''
    // stream 同步返回 handle，回调异步触发 —— 不要 await 这一行
    currentStreamHandle = client.stream(
      chatHistory,
      {
        onChunk(delta) {
          if (myToken !== chatTurnToken) return
          aiText += delta
          win.webContents.send('chat:chunk', delta)
        },
        onDone(usage) {
          // 流式中 chatHistory 被 reset 清空了 → 别 push assistant turn 进去，
          // 否则下次 messages 起头是 assistant，Anthropic 返回 400 invalid_messages
          if (myToken !== chatTurnToken) return
          currentStreamHandle = null
          chatHistory.push({ role: 'assistant', content: aiText })
          trimChatHistory()
          // M5-2：debounce 持久化对话历史
          scheduleChatHistorySave()
          // remember / save_user_profile tool 可能这一轮被调 → 刷新两个缓存
          void refreshPetMemory()
          void refreshUserProfile()
          win.webContents.send('chat:done', usage)
          stateMachine.transition('success')
          stateMachine.scheduleReturnToIdle(SUCCESS_HOLD_MS)
        },
        onError(err) {
          if (myToken !== chatTurnToken) return
          currentStreamHandle = null
          if (chatHistory[chatHistory.length - 1]?.role === 'user') {
            chatHistory.pop()
          }
          win.webContents.send('chat:error', err)
          stateMachine.transition('error')
          stateMachine.scheduleReturnToIdle(ERROR_HOLD_MS)
          // 401 invalid-api-key → 自动清掉坏 key，引导用户重设。
          // M7-4: provider-aware —— 老 resetKey() 只清 Anthropic credentials.bin
          // + setKeyInMemory hardcode 清 anthropic slot；wave 4.2 user 切 OpenAI
          // 输错 key 401 不能误清 anthropic slot。
          if (err.kind === 'invalid-api-key') {
            if (currentSelectedModel.provider === 'anthropic') {
              void resetKey()
            } else {
              // 仅清内存里坏掉的 provider key + 让 llmClient 重建（下次还没新 key
              // 会再次走 'no-api-key' 引导）。盘上文件 cleanup 留 wave 4.4 新 IPC
              // resetProviderKey(provider) 统一处理。user 可立即切回 anthropic 或
              // 换 provider 继续工作。
              currentProviderKeys.set(currentSelectedModel.provider, null)
              llmClient = null
            }
          }
        }
      },
      {
        toolContext: agenticEnabled ? toolCtx : undefined,
        memory: petMemoryCache,
        userProfile: userProfileCache,
        // M8: 让 AI 知道桌宠当前状态（"pet 要知道自己现在是什么状态"）
        currentPetState: stateMachine.getState()
      }
    )
  })

  ipcMain.on('chat:set-open', (_event, open: boolean) => {
    // cr B2: 关闭对话窗 = turn 边界 —— 中止 in-flight stream + ++chatTurnToken 让旧 chunk
    // 不再 push 到 messages，避免"关了对话框，重开看到 stream 累积的内容"
    if (!open && currentStreamHandle) {
      currentStreamHandle.abort()
      currentStreamHandle = null
      chatTurnToken++
      if (chatHistory[chatHistory.length - 1]?.role === 'user') {
        chatHistory.pop()
      }
      if (isWinAlive()) {
        petWindow!.webContents.send('chat:done', { inputTokens: 0, outputTokens: 0 })
      }
      if (!stateMachine.transition('idle')) {
        stateMachine.scheduleReturnToIdle(PET_STATES.thinking.minMs)
      }
    }
    setChatOpen(Boolean(open))
  })
}

function watchScreenEvents(): void {
  const trigger = (): void => reapplyMacVisibility(petWindow)
  screen.on('display-metrics-changed', trigger)
  screen.on('display-added', trigger)
  screen.on('display-removed', trigger)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.deskpet.desktop-pet')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 一次性把旧 desktop-pet/ 目录的 key + prefs 搬到当前 DeskPet/ —— 必须在
  // loadApiKey / loadPreferences 之前，否则首次启动找不到旧 key 走迎宾流。
  await migrateLegacyUserData()

  // M7-4: 把单 Anthropic 时代的 credentials.bin 迁移到新格式 anthropic-key.bin。
  // 必须在 6-key load + resolveStartupKey 之前 —— 保证 anthropic-key.bin 存在再被读。
  // 失败时静默保留老文件下次启动再试。
  await migrateLegacyCredentials()

  // M7-4: 加载 6 个 provider 的 key 到 currentProviderKeys map。
  // 顺序加载 6 个 safeStorage decrypt ~5ms 总，启动开销可忽略。
  // 必须在 resolveStartupKey 之前 —— resolveStartupKey 从 map 取 anthropic key 派生
  // legacy currentApiKey（避免 loadApiKey 读已被 migration 删除的 credentials.bin）。
  for (const provider of PROVIDER_ORDER) {
    currentProviderKeys.set(provider, await resolveProviderKey(provider))
  }
  const loadedProviders = PROVIDER_ORDER.filter((p) => currentProviderKeys.get(p) !== null)
  console.log(
    `[startup] provider keys loaded: ${loadedProviders.length}/${PROVIDER_ORDER.length}` +
      (loadedProviders.length > 0 ? ` (${loadedProviders.join(', ')})` : '')
  )

  // M7-4: resolveStartupKey 现在从 currentProviderKeys.get('anthropic') 派生 legacy
  // currentApiKey —— 取代老 loadApiKey 路径（被 migration unlink 后永远 ENOENT 的 bug fix）。
  await resolveStartupKey()
  // M1-2：加载当前主题元数据（仅 log + 验证 schema，不做 renderer 注入）
  const theme = await loadTheme()
  if (theme) {
    console.log(
      `[theme] loaded "${theme.name}" v${theme.version} by ${theme.author} (schema v${theme.schemaVersion})`
    )
  } else {
    console.warn('[theme] no theme metadata loaded — renderer 仍走 hardcoded GIF imports')
  }
  // load 偏好（找不到 / 损坏 → 用 DEFAULT_PREFS fallback）
  const prefs = await loadPreferences()
  currentModel = prefs.modelId
  currentSelectedModel = prefs.selectedModel
  followFrontApp = prefs.followFrontApp
  useFastPath = prefs.useFastPath
  visionEnabledPref = prefs.visionEnabled
  visionConsentedPref = prefs.visionConsented
  // M9-5b B-1: 启动 seed petMode（createPetWindow 之后才能 setBounds，所以这里仅 seed
  // module state；窗口创建后若 petMode === 'mini' 立即应用 mini bounds —— 在
  // createPetWindow() 调用后做，见下面 startup sequence）
  petMode = prefs.petMode

  // 边缘情况：visionEnabled=true 但 consent=false（异常状态，理论不会发生）
  // 自动 disable 防止意外开了功能
  if (visionEnabledPref && !visionConsentedPref) {
    visionEnabledPref = false
    // M7-4 wave 4.5: 用 currentPrefsSnapshot 而非 spread 老 prefs —— 跟其它 vision
    // handler 一致；启动期本身无 schedulePrefsSave race 但保持 pattern 统一。
    void savePreferences(currentPrefsSnapshot()).catch((e) =>
      console.warn('[startup] reset visionEnabled=false failed:', e)
    )
  }

  // M4-C：加载持久化 trusted dirs + 注册 approval IPC
  await loadPersistentTrustedDirs()
  registerApprovalIpc()

  // M5-2：load 对话历史 + 长期记忆 —— 让桌宠重启后记得上次会话
  const persistedHistory = await loadChatHistory()
  if (persistedHistory.length > 0) {
    chatHistory.push(...persistedHistory)
    trimChatHistory()
    console.log(`[startup] restored ${chatHistory.length} chat messages`)
  }
  petMemoryCache = await loadMemory()
  if (petMemoryCache.length > 0) {
    const lines = petMemoryCache.split('\n').filter((l) => l.trim()).length
    console.log(`[startup] loaded pet-memory.md (${lines} entries)`)
  }
  // M5-3：load user profile —— 决定 system prompt 走 setup wizard 还是正常模式
  userProfileCache = await loadUserProfile()
  if (userProfileCache.setupCompleted) {
    console.log(`[startup] user profile loaded (name=${userProfileCache.name})`)
  } else {
    console.log('[startup] user profile not set up —— AI will run wizard on first chat')
  }

  // M4-D：加载 Tavily key（env 优先 → 加密文件 → null 则 web_search 不暴露）
  currentTavilyApiKey = await resolveTavilyKey()
  if (currentTavilyApiKey) {
    console.log('[startup] Tavily search key loaded — web_search tool enabled')
  } else {
    console.log('[startup] no Tavily key — web_search tool disabled')
  }

  registerIpc()
  createPetWindow()
  // M9-5b B-1: 若 prefs 上次存的是 mini，立即套用 mini bounds. 用 computeModeBounds 直接
  // setBounds，不走 setPetMode (那里有 petMode === mode 早 return guard，prefs seed 完已经
  // === 'mini'，setPetMode('mini') 会 no-op). createTray 在下面，会按 petMode 起 checkbox state.
  if (petMode === 'mini' && petWindow) {
    petWindow.setBounds(computeModeBounds('mini', petWindow.getBounds()))
  }
  // 让 approval.ts 拿到 petWindow 引用，requestApproval 才能发 IPC
  setApprovalPetWindow(petWindow)
  createTray()
  watchScreenEvents()

  // M9-4: 启动时评估 cursor poll —— state=idle + activity 默认 idle → 会启动
  updateCursorPoll()

  // 启动 detector —— 按用户偏好（默认开）
  if (followFrontApp) activeAppMonitor.start()
  // 预热 Anthropic TLS pool：让首次真实 classify 从 ~1000ms 降到 ~250ms（A 根因 1）
  if (currentApiKey) {
    void warmupClassifier(currentApiKey)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('before-quit', () => {
  stopVisibilityWatchdog()
  stopCursorPoll()
  activeAppMonitor.stop()
  // M5-2：强制 flush debounced 对话历史 —— 防退出前最后一条 chat:done 还在
  // 计时器里没落盘
  if (chatHistorySaveTimer) {
    clearTimeout(chatHistorySaveTimer)
    chatHistorySaveTimer = null
    // 同步路径不能 await，但 saveChatHistory 是 fs.writeFile，Node 通常给毫秒级
    // 完成够用；如出现历史丢失再改进同步 fs.writeFileSync
    void saveChatHistory([...chatHistory])
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
