/**
 * Furina theme.json runtime metadata 类型 (v0.5.0 状态机重构).
 *
 * 跟 `themes/deskpet-furina/theme.json` 1:1 对齐. 主进程状态机消费这份元数据
 * 驱动 setState 主流程; renderer 只通过 `pet:state` IPC 收最终扁平状态名,
 * 自己 sprite import map 查 URL, 不读 theme.json.
 *
 * 三种 state type 决定切换语义:
 *  - A 循环: 长期停留, 自身无缝循环 (idle / typing / sleeping)
 *  - B 回归: 触发一次, 播 durMs 后自动回 idle (happy / notification / react-poke)
 *  - C 过渡桥: repeatCount=1 播一次定格, 播完 setState(to) (collapse-sleep / wake)
 */

/** SMIL animation 类型 */
export type ThemeStateType = 'A' | 'B' | 'C'

/** loop 行为, theme.json 里描述但 runtime 只用 type 判断切换语义 */
export type ThemeLoopMode = 'pingpong' | 'subloop' | 'once-freeze'

/** state / transition / reaction / mini 条目的统一 schema */
export interface ThemeStateDef {
  /** sprite SVG 相对路径 (svg/foo.svg) */
  file: string
  type: ThemeStateType
  loop: ThemeLoopMode
  /** B 类必填: 播完回这个 state (通常 'idle') */
  returnTo?: string
  /** C 类入口约束 (from this state). 主要文档用, 状态机不强制 */
  from?: string
  /** C 类必填: 播完自动 setState 到此 */
  to?: string
  /** B / C 必填: 播放时长 (ms). A 类可选 */
  durMs?: number
}

/** agent 事件 → state 名映射 (规格 §4c) */
export type ThemeEventMap = Record<string, string>

/** theme.json 顶层结构 */
export interface ThemeManifest {
  /** schema id (内部) */
  name: string
  /** 用户面板显示名 */
  displayName: string
  version: string
  /** 元数据 */
  author: string
  description: string
  schemaVersion: number
  meta: {
    anchor: string
    canvas: { w: number; h: number }
    format: string
    note: string
  }
  /** A/B 类常规状态 */
  states: Record<string, ThemeStateDef>
  /** C 类过渡桥 (collapse-sleep / wake / mini-enter) */
  transitions: Record<string, ThemeStateDef>
  /** 用户交互反应 (react-drag / react-poke) */
  reactions: Record<string, ThemeStateDef>
  /** mini 模式子状态集 */
  mini: Record<string, ThemeStateDef>
  /** agent event → state 名 */
  eventMap: ThemeEventMap
  /** idle 期 20-40s 随机插的 B 类彩蛋列表 */
  idleEggs: string[]
}

/**
 * 状态优先级 (规格 §3 文末). 高优先级可抢占低优先级;
 * C 类锁状态期间, 只允许 Error 抢占.
 */
export enum StatePriority {
  Idle = 0,
  IdleEgg = 10,
  Working = 20, // typing / building / conducting / sweeping / carrying / juggling / thinking
  CBridge = 30, // 锁定 marker, 只有 Error 能抢
  Notification = 40, // notification / permission
  Error = 50,
  /** 用户主动交互 (react-poke / react-drag), 短暂高优先级展示反应 */
  Reaction = 35
}
