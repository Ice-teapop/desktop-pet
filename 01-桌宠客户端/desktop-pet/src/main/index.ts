/**
 * DeskPet 主进程 — M1 骨架（透明置顶 + 状态机 + IPC + Space 跨越）。
 *
 * 当前职责：
 *   1. 创建右下角透明无边框置顶 + 全 Space 可见的桌宠窗口
 *   2. 持有 PetStateMachine —— 按动画引擎设计文档 5.x + 10.1 实现
 *      （优先级模型 + minMs 防抖 + 状态切换 IPC 广播）
 *   3. IPC：
 *      - 'window:move-delta' 渲染层接管拖动后移动窗口
 *      - 'pet:event:click' 渲染层判定单击后触发 demo 状态循环
 *      - 'pet:state' 主进程 → 渲染层 推送当前状态 ID
 *
 * 还没做（M1 剩余）：点击穿透 + 像素 hit testing、托盘菜单、
 * 主题加载器从配置选 active 主题、Agent 引擎事件总线（M2+）。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const PET_WIDTH = 240
const PET_HEIGHT = 240
const MARGIN_FROM_EDGE = 24

// 优先级越大越高 —— 高优先级状态可以打断当前任何低优先级（不受 minMs 约束）
// 对照《动画引擎与状态机》5.1 优先级表
const STATE_PRIORITY: Record<string, number> = {
  idle: 1,
  sleep: 1,
  thinking: 2,
  drag: 3,
  success: 4,
  working: 5,
  moving: 5,
  organizing: 5,
  building: 5,
  multitask: 5,
  error: 6,
  awaiting: 7
}

// 状态最小显示时长（ms）—— 防抖；防止任务很快时动画「闪一下」就没了
const STATE_MIN_MS: Record<string, number> = {
  idle: 0,
  thinking: 300,
  working: 400,
  success: 1500,
  error: 1200
}

class PetStateMachine {
  private current = 'idle'
  private enteredAt = Date.now()
  private timer: NodeJS.Timeout | null = null

  constructor(private notify: (state: string) => void) {}

  getState(): string {
    return this.current
  }

  /** 尝试切换到 target 状态。受优先级 + minMs 保护。返回是否真的切了。 */
  transition(target: string): boolean {
    if (target === this.current) return false
    const tPrio = STATE_PRIORITY[target] ?? 0
    const cPrio = STATE_PRIORITY[this.current] ?? 0
    const elapsed = Date.now() - this.enteredAt
    const cMin = STATE_MIN_MS[this.current] ?? 0
    if (tPrio > cPrio || elapsed >= cMin) {
      this.current = target
      this.enteredAt = Date.now()
      this.notify(target)
      return true
    }
    return false
  }

  /** M1 demo: 单击 → thinking 2s → success 1.5s → idle。M2 由 Agent 事件驱动。 */
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

  win.setAlwaysOnTop(true, 'floating')
  // M1-5：让桌宠在全屏应用之上、跨 Space 仍可见（macOS 必需）
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  petWindow = win
  win.on('closed', () => {
    if (petWindow === win) petWindow = null
  })

  // 渲染层挂载后立刻推一次当前状态，让首屏正确显示
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('pet:state', stateMachine.getState())
  })

  win.on('ready-to-show', () => win.show())

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
