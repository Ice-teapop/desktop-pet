/**
 * DeskPet 主进程 — M0 骨架。
 *
 * 当前职责：创建一个右下角、透明、置顶、无边框、不抢焦点的桌宠窗口。
 * 还没做：点击穿透 + 像素级 hit testing（M1）、状态机、IPC 业务通道（M1+）。
 *
 * 参考思路（不照搬代码）：clawd-on-desk 的 pet-window-runtime.js 双窗口架构。
 * 我们 M0 先单窗口（hit + pet 合一），M1 再考虑是否拆双窗口。
 */
import { app, BrowserWindow, screen } from 'electron'
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
    // —— 桌宠窗口外壳的核心配置 ——
    frame: false, // 无边框
    transparent: true, // 透明背景
    alwaysOnTop: true, // 置顶
    skipTaskbar: true, // 不进任务栏 / Dock
    hasShadow: false, // 无窗口阴影，避免角色周围出现矩形阴影
    resizable: false,
    focusable: false, // 不抢焦点，不打断用户当前在做的事
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // macOS：'floating' 比默认 'normal' 更鲁棒，在全屏应用之上也能浮在最上。
  // M1 还要加 setVisibleOnAllWorkspaces 让桌宠跟随当前 Space。
  win.setAlwaysOnTop(true, 'floating')

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.deskpet.desktop-pet')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createPetWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

// macOS 习惯：所有窗口关掉后应用不退出（保留在托盘呼出）。
// 桌宠 skipTaskbar=true 不进 Dock —— M1 加托盘菜单后由用户主动退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
