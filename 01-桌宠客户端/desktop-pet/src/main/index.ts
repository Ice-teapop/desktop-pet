/**
 * DeskPet 主进程 — M1（含 M1-7 点击穿透 + watchdog 保活全屏跨越）。
 *
 * 当前职责：
 *   1. 透明无边框置顶窗口 + macOS Space + fullscreen 跨越保活
 *   2. PetStateMachine（按动画引擎设计 5.1 + 5.2 + 10.1）
 *   3. IPC：'window:move-delta'、'pet:event:click'、'pet:state'、'window:ignore-mouse'
 *   4. 系统托盘菜单：显隐桌宠 / 重置位置 / Demo / 退出
 *   5. 点击穿透：默认透明区域穿透 click 到底层 app；渲染层 hit testing 切换
 *
 * macOS visibility 保活策略（对照 clawd-on-desk/src/topmost-runtime.js）：
 * 系统在 Space 切换 / fullscreen enter-exit / display 变化时会主动 reset
 * NSWindow.collectionBehavior，让桌宠从全屏 app 上消失。对策：
 *   - reapplyMacVisibility() 集中重设 level + cross-Space
 *   - watchdog setInterval 1s 周期性 reapply（兜底）
 *   - screen.on(display-*) 事件触发即时 reapply
 *   - IPC 'window:ignore-mouse' 后立即 reapply（setIgnoreMouseEvents 也会 reset）
 *
 * tray / petWindow / visibilityWatchdog 都是模块级引用，避免 GC 后失效。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PET_STATES, type PetState } from '../shared/pet-state'
import trayIconPath from '../../resources/icon.png?asset'

const PET_WIDTH = 240
const PET_HEIGHT = 240
const MARGIN_FROM_EDGE = 24
const VISIBILITY_WATCHDOG_MS = 1000

class PetStateMachine {
  private current: PetState = 'idle'
  private enteredAt = Date.now()
  private timer: NodeJS.Timeout | null = null

  constructor(private notify: (state: PetState) => void) {}

  getState(): PetState {
    return this.current
  }

  /** 尝试切换到 target。受优先级 + minMs 保护。返回是否真的切了。 */
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

  /** M1 demo：单击 → thinking 2s → success 1.5s → idle。M2 由 Agent 事件驱动。 */
  demoCycle(): void {
    if (this.timer) clearTimeout(this.timer)
    this.transition('thinking')
    this.timer = setTimeout(() => {
      this.transition('success')
      this.timer = setTimeout(() => {
        this.transition('idle')
        this.timer = null
      }, 1500)
    }, 2000)
  }
}

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let visibilityWatchdog: NodeJS.Timeout | null = null
const stateMachine = new PetStateMachine((state) => {
  petWindow?.webContents.send('pet:state', state)
})

/**
 * 集中重设 macOS 窗口可见性（level + cross-Space）。所有可能 reset
 * NSWindow.collectionBehavior 的时机都调一次，外加 1s watchdog 兜底。
 */
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

function createPetWindow(): void {
  const { workArea } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: workArea.x + workArea.width - PET_WIDTH - MARGIN_FROM_EDGE,
    y: workArea.y + workArea.height - PET_HEIGHT - MARGIN_FROM_EDGE,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    // macOS 上创建为 NSPanel —— NSPanel 默认 nonactivating，
    // 既支持跨 Space + fullscreen 又不抢键盘焦点（最重要的特性组合）
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    // KEY: focusable 必须 true 才能让 setVisibleOnAllWorkspaces 真正生效。
    // 之前 false 会让 NSPanel 进入 nonactivating + can't-join-spaces 的状态组合，
    // setVisibleOnAllWorkspaces silently 失效。Linux 保留 false（按 clawd 注释 Linux
    // 有 WS_EX_NOACTIVATE 不同的 bug 路径）。
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
    // 顺序：先设穿透，再设可见性 —— setIgnoreMouseEvents 会 reset collection behavior，
    // 必须让 visibility 调用排在它后面才能持久生效。
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
    reapplyMacVisibility(petWindow) // show 后 collection behavior 可能被重置
  }
}

function resetPetPosition(): void {
  if (!petWindow) return
  const { workArea } = screen.getPrimaryDisplay()
  petWindow.setPosition(
    workArea.x + workArea.width - PET_WIDTH - MARGIN_FROM_EDGE,
    workArea.y + workArea.height - PET_HEIGHT - MARGIN_FROM_EDGE
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
    // 立即兜底，不等下一次 watchdog tick —— 鼠标进/出 hit zone 切换频繁，
    // 1s watchdog 间隔下用户可能看到桌宠在全屏 app 上闪失
    reapplyMacVisibility(win)
  })
}

/**
 * 监听 screen 模块的 display 变化事件 —— 切显示器 / 缩放变更等会 reset
 * collection behavior，主动触发 reapply 而不依赖 watchdog 周期。
 */
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
