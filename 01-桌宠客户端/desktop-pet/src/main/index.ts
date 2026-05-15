/**
 * DeskPet 主进程 — M1（cr #1 #3 修复 + M1-6 托盘菜单）。
 *
 * 当前职责：
 *   1. 透明无边框置顶窗口 + macOS Space + fullscreen 跨越
 *   2. PetStateMachine（按动画引擎设计 5.1 + 5.2 + 10.1）
 *   3. IPC：'window:move-delta'、'pet:event:click'、'pet:state'
 *   4. 系统托盘菜单：显隐桌宠 / 重置位置 / Demo / 退出
 *
 * 注意：'screen-saver' 是 macOS 让窗口高于全屏应用的关键 level
 * （对照 clawd-on-desk/src/topmost-runtime.js 的 MAC_TOPMOST_LEVEL）。
 * setAlwaysOnTop + setVisibleOnAllWorkspaces 都在 ready-to-show 之后调，
 * 避开窗口尚未就绪时 collection behavior 被 reset 的早期 macOS bug。
 *
 * tray 必须保持模块级引用，否则 GC 后图标会消失。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PET_STATES, type PetState } from '../shared/pet-state'
import trayIconPath from '../../resources/icon.png?asset'

const PET_WIDTH = 240
const PET_HEIGHT = 240
const MARGIN_FROM_EDGE = 24

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
const stateMachine = new PetStateMachine((state) => {
  petWindow?.webContents.send('pet:state', state)
})

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
    focusable: false,
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
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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
  else petWindow.show()
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
  // macOS 托盘图标推荐 16–22px。M1 用脚手架自带 electron logo 占位，M2 换原创螃蟹
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
    {
      label: '重置位置（右下角）',
      click: resetPetPosition
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
  tray.setContextMenu(menu)

  // 单击托盘图标 = 显隐切换（macOS 标准交互）
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
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.deskpet.desktop-pet')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createPetWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
