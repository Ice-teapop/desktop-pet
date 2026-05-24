/**
 * 主题元数据加载器 (v0.5.0 扩展) —— 读 themes/deskpet-furina/theme.json 完整结构
 * (states / transitions / reactions / mini / eventMap / idleEggs), 给主进程状态机消费.
 *
 * 启动 once-load + module 级 cache; 运行时通过 getTheme() / lookupState() 同步访问.
 * (themes/X/theme.json 启动后不变, 切主题需重启 — 跟之前 "不做主题切换" 注释一致)
 *
 * 失败 fallback: 找不到文件 / 解析失败 / schema 校验不过 → 返回 null + warn,
 * 状态机自己有 hardcoded 兜底 (idle/sleeping/wake/collapse-sleep 最小集).
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ThemeManifest, ThemeStateDef } from '../../shared/theme-types'

const THEME_DIR = 'themes/deskpet-furina'
const THEME_FILE = 'theme.json'

let cachedTheme: ThemeManifest | null = null

function themePath(): string {
  return join(app.getAppPath(), THEME_DIR, THEME_FILE)
}

/** 单条 state def validate; 返回 narrowed def 或 null (静默丢) */
function validateStateDef(raw: unknown, key: string): ThemeStateDef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.file !== 'string') return null
  if (r.type !== 'A' && r.type !== 'B' && r.type !== 'C') {
    console.warn(`[theme] state "${key}" invalid type=${String(r.type)}`)
    return null
  }
  if (r.loop !== 'pingpong' && r.loop !== 'subloop' && r.loop !== 'once-freeze') {
    console.warn(`[theme] state "${key}" invalid loop=${String(r.loop)}`)
    return null
  }
  // B 类要 returnTo; C 类要 to (这俩仍必填, 缺了 state machine 没法跑完整路径)
  if (r.type === 'B' && typeof r.returnTo !== 'string') {
    console.warn(`[theme] B state "${key}" missing returnTo, defaulting to 'idle'`)
  }
  if (r.type === 'C' && typeof r.to !== 'string') {
    console.warn(`[theme] C state "${key}" missing to, defaulting to 'idle'`)
  }
  // durMs 缺失 → state-machine.ts 内有 default (B=6000, C=3080), 不算 fatal
  return {
    file: r.file,
    type: r.type,
    loop: r.loop,
    returnTo: typeof r.returnTo === 'string' ? r.returnTo : undefined,
    from: typeof r.from === 'string' ? r.from : undefined,
    to: typeof r.to === 'string' ? r.to : undefined,
    durMs: typeof r.durMs === 'number' ? r.durMs : undefined
  }
}

/** 把 key→def 映射的 record 走 validate 一遍, 丢 invalid 条目 */
function validateRecord(raw: unknown): Record<string, ThemeStateDef> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, ThemeStateDef> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = validateStateDef(v, k)
    if (def) out[k] = def
  }
  return out
}

export async function loadTheme(): Promise<ThemeManifest | null> {
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
      typeof obj.displayName !== 'string'
    ) {
      console.warn('[theme] schema missing required top-level fields')
      return null
    }
    const meta = (obj.meta as Record<string, unknown>) ?? {}
    const canvas = (meta.canvas as Record<string, unknown>) ?? {}
    const theme: ThemeManifest = {
      name: obj.name,
      displayName: obj.displayName,
      version: obj.version,
      author: typeof obj.author === 'string' ? obj.author : 'unknown',
      description: typeof obj.description === 'string' ? obj.description : '',
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      meta: {
        anchor: typeof meta.anchor === 'string' ? meta.anchor : '',
        canvas: {
          w: typeof canvas.w === 'number' ? canvas.w : 300,
          h: typeof canvas.h === 'number' ? canvas.h : 300
        },
        format: typeof meta.format === 'string' ? meta.format : 'svg-smil',
        note: typeof meta.note === 'string' ? meta.note : ''
      },
      states: validateRecord(obj.states),
      transitions: validateRecord(obj.transitions),
      reactions: validateRecord(obj.reactions),
      mini: validateRecord(obj.mini),
      eventMap: (obj.eventMap as Record<string, string>) ?? {},
      idleEggs: Array.isArray(obj.idleEggs) ? (obj.idleEggs as string[]) : []
    }
    cachedTheme = theme
    console.log(
      `[theme] loaded "${theme.name}" v${theme.version} — ` +
        `${Object.keys(theme.states).length} states, ` +
        `${Object.keys(theme.transitions).length} transitions, ` +
        `${Object.keys(theme.reactions).length} reactions, ` +
        `${theme.idleEggs.length} idleEggs, ` +
        `${Object.keys(theme.eventMap).length} eventMap entries`
    )
    return theme
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      console.warn(`[theme] not found at ${themePath()}`)
    } else {
      console.warn('[theme] load failed:', err)
    }
    return null
  }
}

/** 同步访问 (启动 loadTheme() resolve 后才有值, 启动前调返 null) */
export function getTheme(): ThemeManifest | null {
  return cachedTheme
}

/**
 * 扁平化 lookup —— 状态机不关心 state 来自哪个 namespace
 * (states / transitions / reactions / mini), 按这个顺序查表.
 * mini 模式专属状态如 mini-idle 内部 key 是 'idle', 加 'mini-' 前缀路由.
 */
export function lookupState(name: string): ThemeStateDef | null {
  if (!cachedTheme) return null
  // 直接查 states / transitions / reactions
  const direct =
    cachedTheme.states[name] ||
    cachedTheme.transitions[name] ||
    cachedTheme.reactions[name]
  if (direct) return direct
  // mini-* 前缀路由到 mini namespace
  if (name.startsWith('mini-')) {
    return cachedTheme.mini[name.slice(5)] ?? null
  }
  return null
}

/** 给 dispatchEvent 用: 事件名 → state 名 (Stage C 才会真接入) */
export function lookupEvent(eventName: string): string | null {
  return cachedTheme?.eventMap[eventName] ?? null
}

/** idle 彩蛋列表 (Stage B armIdleEggs 用) */
export function getIdleEggs(): string[] {
  return cachedTheme?.idleEggs ?? []
}
