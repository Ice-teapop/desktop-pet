/**
 * DeskPet 主进程 — M1-8（cr 复审三项修复 #1 #2 #3）。
 *
 * 修复要点：
 *   - #1 智能扩展方向：检测桌宠中心在屏幕哪一边，决定窗口往左/右展，
 *     桌宠在左半屏时往右扩（不出屏），右半屏时往左扩（原行为）；x 加边界 clamp
 *   - #2/#3 配合渲染层的两阶段过渡：开屏 setBounds 完成后 IPC 'chat:window-ready'
 *     通知渲染层 fade-in conversation；关屏由渲染层 fade-out 完成后才回 setChatOpen(false)
 *
 * 其它（M1-7 基础）：透明 NSPanel + focusable:true / Space 跨越 watchdog /
 * 'screen-saver' level / 点击穿透 IPC / SUCCESS_HOLD_MS=minMs+100 防 transition 拦截。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PET_STATES, type PetState } from '../shared/pet-state'
import trayIconPath from '../../resources/icon.png?asset'

const WIN_WIDTH_COMPACT = 260
const WIN_WIDTH_FULL = 500 // 像素风字体更紧凑，对话区可以缩到 230px（之前 280）
const WIN_HEIGHT = 280
const MARGIN_FROM_EDGE = 24
const VISIBILITY_WATCHDOG_MS = 1000
// setBounds animate=true 默认 ~250ms（macOS）；其它平台无动画。固定 320ms 等动画完。
const WINDOW_RESIZE_ANIM_MS = 320

const ECHO_DELAY_MS = 1500
const SUCCESS_HOLD_MS = PET_STATES.success.minMs + 100

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

  chatCycle(onReplyReady: () => void): void {
    if (this.timer) clearTimeout(this.timer)
    this.transition('thinking')
    this.timer = setTimeout(() => {
      onReplyReady()
      this.transition('success')
      this.timer = setTimeout(() => {
        this.transition('idle')
        this.timer = null
      }, SUCCESS_HOLD_MS)
    }, ECHO_DELAY_MS)
  }
}

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let visibilityWatchdog: NodeJS.Timeout | null = null
const stateMachine = new PetStateMachine((state) => {
  petWindow?.webContents.send('pet:state', state)
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

/**
 * 切换对话 UI 对应的窗口尺寸 —— 关闭 compact，打开 full。
 *
 * 智能扩展方向（修 cr #1）：
 *   - 桌宠中心在屏幕右半 → 对话往左扩（窗口左上角 x 减小）
 *   - 桌宠中心在屏幕左半 → 对话往右扩（窗口左上角 x 不动，桌宠保持在窗口右侧）
 *   - 边界 clamp 确保 x 始终在 workArea 内
 * 关屏方向同样基于当前窗口位置反推，保持桌宠视觉位置不变。
 *
 * 开屏完成后 setTimeout 等动画结束发 'chat:window-ready' 通知渲染层 fade-in
 * conversation（修 cr #2）。
 */
function setChatOpen(open: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const newW = open ? WIN_WIDTH_FULL : WIN_WIDTH_COMPACT
  const [oldW] = petWindow.getSize()
  if (oldW === newW) return

  const [x, y] = petWindow.getPosition()
  // 用 getDisplayMatching 拿当前窗口所在的显示器（多屏场景对的）
  const display = screen.getDisplayMatching({ x, y, width: oldW, height: WIN_HEIGHT })
  const { workArea } = display

  const centerX = x + oldW / 2
  const screenCenterX = workArea.x + workArea.width / 2
  const expandsLeft = centerX > screenCenterX // 右半屏 → 往左扩；左半屏 → 往右扩

  let newX: number
  if (open) {
    newX = expandsLeft ? x + (oldW - newW) : x // 往左扩 x 减小；往右扩 x 不动
  } else {
    newX = expandsLeft ? x + (oldW - newW) : x // 关屏方向跟开屏一致即保持桌宠原位
  }

  // 边界 clamp：x ∈ [workArea.x, workArea.x + workArea.width - newW]
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - newW
  newX = Math.max(minX, Math.min(newX, maxX))

  petWindow.setBounds(
    { x: newX, y, width: newW, height: WIN_HEIGHT },
    true // animate（macOS 上 setBounds 第二参数启用过渡）
  )
  reapplyMacVisibility(petWindow)

  // 开屏：等窗口动画完成（macOS ~250ms）后通知渲染层 fade-in conversation
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
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    focusable: process.platform !== 'linux',
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  petWindow = win
  win.on('closed', () => {
    if (petWindow === win) petWindow = null
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('pet:state', stateMachine.getState())
  })

  win.on('ready-to-show', () => {
    win.show()
    win.setIgnoreMouseEvents(true, { forward: true })
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

function resetPetPosition(): void {
  if (!petWindow) return
  const { workArea } = screen.getPrimaryDisplay()
  const [w] = petWindow.getSize()
  petWindow.setPosition(
    workArea.x + workArea.width - w - MARGIN_FROM_EDGE,
    workArea.y + workArea.height - WIN_HEIGHT - MARGIN_FROM_EDGE
  )
}

function createTray(): void {
  let image = nativeImage.createFromPath(trayIconPath)
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18 })
  }
  tray = new Tray(image)
  tray.setToolTip('DeskPet 桌宠')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏桌宠',
      accelerator: 'CmdOrCtrl+Shift+P',
      click: togglePetVisibility
    },
    { label: '重置位置（右下角）', click: resetPetPosition },
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
  tray.setContextMenu(menu)
  tray.on('click', togglePetVisibility)
}

function registerIpc(): void {
  ipcMain.on('window:move-delta', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
  })

  ipcMain.on('pet:event:click', () => {
    stateMachine.demoCycle()
  })

  ipcMain.on('window:ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
    reapplyMacVisibility(win)
  })

  ipcMain.on('chat:submit', (event, text: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const cleaned = String(text).slice(0, 2000).trim()
    if (!cleaned) return
    stateMachine.chatCycle(() => {
      win.webContents.send('chat:reply', `🤖 收到：${cleaned}`)
    })
  })

  ipcMain.on('chat:set-open', (_event, open: boolean) => {
    setChatOpen(Boolean(open))
  })
}

function watchScreenEvents(): void {
  const trigger = (): void => reapplyMacVisibility(petWindow)
  screen.on('display-metrics-changed', trigger)
  screen.on('display-added', trigger)
  screen.on('display-removed', trigger)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.deskpet.desktop-pet')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createPetWindow()
  createTray()
  watchScreenEvents()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('before-quit', () => {
  stopVisibilityWatchdog()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
