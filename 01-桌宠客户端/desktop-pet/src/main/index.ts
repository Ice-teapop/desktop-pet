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
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PET_STATES, type PetState } from '../shared/pet-state'
import {
  ACTIVITY_INFO,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  type ActivityState,
  type ChatMessage,
  type KeyState,
  type ModelId
} from '../shared/chat-types'
import {
  AnthropicLlmClient,
  getApiKeyFromEnv,
  looksLikeApiKey,
  type StreamHandle
} from './llm/anthropic'
import {
  classifyApp,
  clearClassifyCache,
  tryFastPath,
  warmupClassifier,
  type AppIdentity
} from './llm/activity-classifier'
import { clearApiKey, loadApiKey, saveApiKey } from './storage/credentials'
import { loadPreferences, savePreferences, type Preferences } from './storage/preferences'
import { migrateLegacyUserData } from './storage/migration'
import { loadTheme } from './storage/theme'
import { ActiveAppMonitor } from './services/active-app'
import { ALL_TOOLS, executeTool as runTool, type ToolDef } from './llm/tools'
import type { VisionState } from '../shared/vision-types'
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

class PetStateMachine {
  private current: PetState = 'idle'
  private enteredAt = Date.now()
  private timer: NodeJS.Timeout | null = null

  constructor(private notify: (state: PetState) => void) {}

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
      return true
    }
    return false
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

// 主进程 = 对话历史 / API key / keyState / model / activity 单一事实来源
const chatHistory: ChatMessage[] = []
let currentApiKey: string | null = null
let keyState: KeyState = 'missing'
let currentModel: ModelId = DEFAULT_MODEL
let llmClient: AnthropicLlmClient | null = null
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
    return await classifyApp(app, currentApiKey, currentModel)
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
  schedulePrefsSave({ modelId: currentModel, followFrontApp, useFastPath, visionEnabled: visionEnabledPref, visionConsented: visionConsentedPref })
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
  schedulePrefsSave({ modelId: currentModel, followFrontApp, useFastPath, visionEnabled: visionEnabledPref, visionConsented: visionConsentedPref })
}

function setKeyInMemory(key: string | null): void {
  currentApiKey = key
  // 重置缓存 client —— 下次 getLlmClient 会用新 key 重建
  llmClient = null
  keyState = key ? 'ready' : 'missing'
}

function getLlmClient(): AnthropicLlmClient | null {
  if (llmClient) return llmClient
  if (!currentApiKey) return null
  llmClient = new AnthropicLlmClient(currentApiKey, currentModel)
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
  llmClient = null
  currentStreamHandle?.abort()
  currentStreamHandle = null
  chatTurnToken++
  rebuildTrayMenu()
  schedulePrefsSave({ modelId: id, followFrontApp, useFastPath, visionEnabled: visionEnabledPref, visionConsented: visionConsentedPref })
}

function trimChatHistory(): void {
  const limit = MAX_HISTORY_PAIRS * 2
  if (chatHistory.length > limit) {
    chatHistory.splice(0, chatHistory.length - limit)
  }
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
  const fromDisk = await loadApiKey()
  setKeyInMemory(fromDisk)
}

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let visibilityWatchdog: NodeJS.Timeout | null = null
const stateMachine = new PetStateMachine((state) => {
  if (isWinAlive()) petWindow!.webContents.send('pet:state', state)
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
  // cr B1: classifier cache 跨 key 身份不该残留 —— 上一个 key 用 LLM 分类出来的结果可能
  // 是错的（Anthropic 偶发抽风），如果不清，重设 key 后那个错误分类会永久命中缓存
  clearClassifyCache()
  ensurePetVisible()
  notifyKeyState()
  await queueCredentialOp(async () => {
    try {
      await clearApiKey()
    } catch (err) {
      console.error('[resetKey] clearApiKey failed:', err)
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
  ipcMain.on('window:move-delta', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
  })

  ipcMain.on('window:ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
    reapplyMacVisibility(win)
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
    // 串行化：避免与任何 in-flight resetKey 的 clearApiKey 撞车
    let persisted = true
    await queueCredentialOp(async () => {
      try {
        await saveApiKey(key)
      } catch (err) {
        console.error('[key:submit] saveApiKey failed:', err)
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
      const prefs = await loadPreferences()
      await savePreferences({
        ...prefs,
        visionConsented: true,
        visionEnabled: true
      })
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
      const prefs = await loadPreferences()
      await savePreferences({ ...prefs, visionEnabled: enabled })
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
      const prefs = await loadPreferences()
      await savePreferences({ ...prefs, visionConsented: false, visionEnabled: false })
    } catch (err) {
      console.warn('[vision:revoke-consent] savePreferences failed:', err)
    }
  })

  ipcMain.on('vision:request-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('vision:state', visionState())
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

    // —— M4-B agentic tools —— AI 通过 tool_use 自主决定调用哪些 local tool。
    // tools 池：vision 类工具（view_screen / read_clipboard）需要 vision consent；
    // 动作类（open_url / copy_to_clipboard / current_app_info）只需要 consent
    // 同样的 gate（一次 consent 给所有 agentic 能力，UX 简单）。
    const agenticEnabled = visionEnabledPref && visionConsentedPref
    const tools: ToolDef[] = agenticEnabled ? [...ALL_TOOLS] : []
    const executeTool = agenticEnabled
      ? (name: string, input: unknown): ReturnType<typeof runTool> =>
          runTool(name, input, {
            petWindow,
            currentActivity,
            currentAppName,
            currentAppBundleId
          })
      : undefined

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
          // 401 invalid-api-key → 自动清掉坏 key，引导用户重设
          if (err.kind === 'invalid-api-key') {
            void resetKey()
          }
        }
      },
      { tools, executeTool }
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
  followFrontApp = prefs.followFrontApp
  useFastPath = prefs.useFastPath
  visionEnabledPref = prefs.visionEnabled
  visionConsentedPref = prefs.visionConsented

  // 边缘情况：visionEnabled=true 但 consent=false（异常状态，理论不会发生）
  // 自动 disable 防止意外开了功能
  if (visionEnabledPref && !visionConsentedPref) {
    visionEnabledPref = false
    void savePreferences({ ...prefs, visionEnabled: false }).catch((e) =>
      console.warn('[startup] reset visionEnabled=false failed:', e)
    )
  }

  registerIpc()
  createPetWindow()
  createTray()
  watchScreenEvents()

  // 启动 detector —— 按用户偏好（默认开）
  if (followFrontApp) activeAppMonitor.start()
  // 预热 Anthropic TLS pool：让首次真实 classify 从 ~1000ms 降到 ~250ms（A 根因 1）
  if (currentApiKey) {
    void warmupClassifier(currentApiKey, currentModel)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('before-quit', () => {
  stopVisibilityWatchdog()
  activeAppMonitor.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
