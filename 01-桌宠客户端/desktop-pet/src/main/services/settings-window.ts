/**
 * 设置面板独立窗口（M5）—— 跟桌宠透明 NSPanel 完全分开。
 *
 * 路由：复用 renderer bundle，hash = #settings 让 main.tsx 渲染 Settings 组件。
 * 单例：重复调 createSettingsWindow 时 focus 已有窗口，不重复创建。
 * 关闭：直接 close（不隐藏）—— 下次打开重新走 hash route + IPC re-subscribe。
 */
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

let settingsWindow: BrowserWindow | null = null

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const win = new BrowserWindow({
    width: 620,
    height: 720,
    title: 'DeskPet 设置',
    show: false,
    // 不透明、标准 chrome、可拖动 —— 跟桌宠透明 panel 行为完全相反
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#f7f1e6', // 跟主题 --paper 一致，避免 mount 前白屏闪
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      devTools: is.dev
    }
  })

  settingsWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })

  // 走 hash route —— renderer 入口检测 #settings 渲染 Settings 组件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#settings')
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }

  return win
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow
}
