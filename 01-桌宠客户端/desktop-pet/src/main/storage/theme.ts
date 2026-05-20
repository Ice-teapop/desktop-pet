/**
 * 主题元数据加载器（M1-2，最小化范围）—— 读 themes/deskpet-cc/theme.json 验证 schema 返
 * 回结构化数据，启动时 log 主题信息。
 *
 * 范围说明（做小不做大，careful-coder 纪律）：
 *  - **只做**：load + validate 核心字段 + log
 *  - **不做**：主题切换 / 多主题枚举 / renderer 动态注入 GIF URL
 *    （GIF URL 通过 vite asset bundle 在 build 时确定为 hash-named asar 路径，
 *     运行时切主题需要单独的 protocol handler 跟 IPC，留给以后真要换主题再做）
 *
 * 失败 fallback：找不到文件 / JSON 坏 / schema 不全 → 返回 null 不崩 app（renderer
 * 已经 hardcode import 了 GIF，不依赖此返回值跑）。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const THEME_DIR = 'themes/deskpet-cc'
const THEME_FILE = 'theme.json'

export interface ThemeInfo {
  name: string
  version: string
  author: string
  description: string
  schemaVersion: number
}

function themePath(): string {
  // app.getAppPath() 在 dev 返项目根目录、prod 返 app.asar 路径（fs 透明读 asar）
  return join(app.getAppPath(), THEME_DIR, THEME_FILE)
}

export async function loadTheme(): Promise<ThemeInfo | null> {
  try {
    const raw = await fs.readFile(themePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[theme] parsed JSON not an object')
      return null
    }
    const obj = parsed as Record<string, unknown>
    if (
      typeof obj.name !== 'string' ||
      typeof obj.version !== 'string' ||
      typeof obj.author !== 'string' ||
      typeof obj.description !== 'string' ||
      typeof obj.schemaVersion !== 'number'
    ) {
      console.warn('[theme] schema missing required fields')
      return null
    }
    return {
      name: obj.name,
      version: obj.version,
      author: obj.author,
      description: obj.description,
      schemaVersion: obj.schemaVersion
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      console.warn(`[theme] not found at ${themePath()} (AGPL gitignore on fresh clone?)`)
    } else {
      console.warn('[theme] load failed:', err)
    }
    return null
  }
}
