/**
 * DeskPet 主进程 — M0.5 骨架（透明置顶 + IPC 窗口拖动）。
 *
 * 当前职责：
 *   1. 创建右下角透明无边框置顶窗口
 *   2. 监听 IPC 'window:move-delta'：让渲染层接管的鼠标拖动能真正移动窗口
 *
 * 还没做：点击穿透 + 像素级 hit testing（M1）、状态机、托盘菜单。
 *
 * 参考思路：clawd-on-desk 的 pet-window-runtime.js 双窗口架构 +
 * Pointer Capture 拖动。我们 M0.5 单窗口 + IPC delta 拖动 ——
 * 简单但够用，M1 看是否升级为 Pointer Capture / 双窗口。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const PET_WIDTH = 240
const PET_HEIGHT = 240
const MARGIN_FROM_EDGE = 24

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

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 渲染层算出的鼠标 dx/dy 增量 → 主进程移动窗口位置。
// 由 App.tsx 的拖动状态机驱动（距离阈值方案：< 5px 是点击，≥ 5px 进入拖动）。
function registerIpc(): void {
  ipcMain.on('window:move-delta', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
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
