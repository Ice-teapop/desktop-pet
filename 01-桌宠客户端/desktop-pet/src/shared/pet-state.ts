/**
 * PetState 类型枚举 (v0.5.0 重构) —— 仅作 IPC 协议跟 sprite import map.
 *
 * v0.5.0 之前: hardcoded PET_STATES 枚举含 priority/minMs, 状态机 logic 写死.
 * v0.5.0 之后: 状态机 logic 全 theme.json driven (见 src/main/state-machine.ts),
 *   这里只剩"合法状态名" 跟 IPC type 用. priority/minMs/type/durMs 等元数据
 *   全从 theme.json 读, 不再 hardcode.
 *
 * State union 包含两类:
 *  - Furina theme.json key (v0.5.0+ canonical): 'idle', 'happy', 'collapse-sleep' ...
 *  - 老 v0.4.x crab 时代别名 (向后兼容, 状态机内部 aliasMap 译到 canonical):
 *    'success' → 'happy', 'sleep' → 'sleeping', 'collapsing' → 'collapse-sleep' etc.
 *    Renderer App.tsx 老的 if-else 链还在用别名, Stage B 才统一改名.
 */

/** Furina theme.json canonical state names (Stage A 引入) */
export type FurinaCanonicalState =
  // states (A 循环)
  | 'idle'
  | 'idle-living'
  | 'idle-look'
  | 'idle-yawn'
  | 'thinking'
  | 'typing'
  | 'building'
  | 'juggling'
  | 'conducting'
  | 'sweeping'
  | 'carrying'
  | 'sleeping'
  | 'error'
  // states (B 回归)
  | 'happy'
  | 'notification'
  // transitions (C 过渡桥)
  | 'collapse-sleep'
  | 'wake'
  | 'mini-enter'
  // reactions
  | 'react-drag'
  | 'react-poke'

/** 老 crab 时代别名 (向后兼容, state-machine.ts:ALIAS_MAP 解析). Stage C 已收的别名
 *  不在此 list, callers 已改 canonical (见 state-machine.ts ALIAS_MAP 顶注).
 *
 *  **单一来源** — state-machine.ALIAS_MAP keys 通过 `satisfies Record<LegacyAliasState, string>`
 *  与此 list 在 TS 编译期强绑定, 添/删别名只改这一处即可. */
export const LEGACY_ALIAS_NAMES = [
  'sleep', // → sleeping
  'collapsing', // → collapse-sleep
  'waking', // → wake
  'drag', // → react-drag
  'yawning', // → (deprecated, sleep chain 现在直接 collapse-sleep)
  'dozing', // → (deprecated)
  'working' // → typing (LLM tool 调用; cc 主题 theme.json 还在用)
] as const

export type LegacyAliasState = (typeof LEGACY_ALIAS_NAMES)[number]

export type PetState = FurinaCanonicalState | LegacyAliasState

/** M8 表演动画 enum —— AI 通过 set_pet_animation tool 主动触发的子集.
 *  Stage C: grooving/celebrating/ultrathink 三个 alias 收掉; thinking 也移除 (chat:submit
 *  会自动 setState('thinking'), LLM 在 chat 中调 set_pet_animation('thinking') 永远 block
 *  → 重复 surface 反而让 LLM 误以为失败). 留 5 个真正 LLM 可触发的动画. */
export type PetAnimation =
  | 'juggling'
  | 'sweeping'
  | 'conducting'
  | 'carrying'
  | 'happy'

export const PET_ANIMATIONS: ReadonlyArray<PetAnimation> = [
  'juggling',
  'sweeping',
  'conducting',
  'carrying',
  'happy'
]

export function isPetAnimation(s: string): s is PetAnimation {
  return PET_ANIMATIONS.includes(s as PetAnimation)
}

/**
 * v0.5.0 cross-fade 单边时长 (规格 §5.3 万能顺滑剂 80-120ms).
 * Stage A 暂用 100ms; Stage B 引入 render 层 crossfade 用此常量.
 */
export const RENDERER_FADE_HALF_MS = 100

/**
 * v0.5.0: 合法 state 集合 (canonical + 老别名). state-machine.ts ALIAS_MAP 把
 * 老别名映射到 canonical 后再查 theme.json. 这里只作运行时校验入口.
 */
const ALL_PET_STATES = new Set<string>([
  // canonical
  'idle',
  'idle-living',
  'idle-look',
  'idle-yawn',
  'thinking',
  'typing',
  'building',
  'juggling',
  'conducting',
  'sweeping',
  'carrying',
  'sleeping',
  'error',
  'happy',
  'notification',
  'collapse-sleep',
  'wake',
  'mini-enter',
  'react-drag',
  'react-poke',
  // legacy aliases (cc 主题 + sleep-chain 兼容; Stage C 已收: success / looking_around /
  // poked / awaiting / grooving / celebrating / ultrathink / multitask / moving / organizing).
  // spread LEGACY_ALIAS_NAMES — 单一来源, 添/删别名只改顶部 const 即可
  ...LEGACY_ALIAS_NAMES
])

/** 类型守卫: IPC 入口校验防 attack */
export function isPetState(s: string): s is PetState {
  return ALL_PET_STATES.has(s)
}
