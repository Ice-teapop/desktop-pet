/**
 * DeskPet 主进程 — M1（修复 #1 #3）。
 *
 * 当前职责：
 *   1. 透明无边框置顶窗口 + macOS Space + fullscreen 跨越
 *   2. PetStateMachine（按动画引擎设计 5.1 + 5.2 + 10.1）
 *      —— 状态优先级 + minMs 防抖；状态枚举从 src/shared/pet-state.ts 单一源拿
 *   3. IPC：'window:move-delta'、'pet:event:click'、'pet:state'
 *
 * 注意：'screen-saver' 是 macOS 让窗口"高于全屏应用"的关键 level
 * （对照 clawd-on-desk/src/topmost-runtime.js 的 MAC_TOPMOST_LEVEL）。
 * setAlwaysOnTop + setVisibleOnAllWorkspaces 都在 ready-to-show 之后调，
 * 避开窗口尚未就绪时 collection behavior 被 reset 的早期 macOS bug。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PET_STATES, type PetState } from '../shared/pet-state'

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
    // 在窗口真正可见后再设 level + collection behavior —— 早期调可能被 reset。
    // 'screen-saver' 是 macOS 让窗口浮于全屏应用之上的关键 level（修 cr #1）。
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
