/**
 * 桌宠状态枚举 —— 单一事实来源（main / preload / renderer 都从这里 import）。
 *
 * 对照《动画引擎与状态机》第三章状态清单 + 5.1 优先级表。
 * 主进程的状态机用 priority / minMs；preload 仅用 PetState 联合类型作 IPC 协议；
 * 渲染层用 PetState 决定显示哪个 SVG。
 */

/**
 * 状态配置：
 * - priority：数值越大越高，高优先级可立刻打断当前任何低优先级状态
 * - minMs：最小显示时长，受 minMs 保护期内不被同/低优先级目标打断
 *
 * 设计目标对照 5.1 + 5.2：
 * - awaiting（等待确认）最高，安全关键，不能被盖
 * - error 次之，需要用户注意
 * - drag 是叠加交互态
 * - success 短暂庆祝，需保证播完（minMs 1500ms）
 * - 执行类（working/moving/organizing/building/multitask）同级，按事件最新值
 * - thinking 略高于 idle/sleep
 */
export const PET_STATES = {
  idle: { priority: 1, minMs: 0 },
  // —— M9-3 多阶段 sleep chain（Officer B 校准 minMs = SVG CSS animation dur） ——
  // idle 60s → yawning 3.8s → dozing 4s → collapsing 1s → sleep
  // 每阶段 priority 1 跟 idle 同级 —— thinking (prio 2) 能随时打断；chain timer
  // 用 nested setTimeout（每 phase 成功 transition 才 schedule 下一个），消除
  // absolute timer + jitter 让阶段被 minMs gate silently 跳过 race
  yawning: { priority: 1, minMs: 3800 },    // clawd-idle-yawn.svg dur=3.8s
  dozing: { priority: 1, minMs: 4000 },     // clawd-idle-doze.svg dur=4s (infinite loop, 切一个完整周期)
  collapsing: { priority: 1, minMs: 1000 }, // clawd-idle-collapse.svg dur=1s
  sleep: { priority: 1, minMs: 0 },
  // 惊醒动画：priority 2 让其能从 sleep chain 任意阶段抢占；minMs 0 让 thinking
  // 能随时抢（user 在 wake 期间 chat 时不被 wake 卡住）；scheduleReturnToIdle
  // 给 1500ms 让 wake SVG 动画播完整（clawd-wake.svg dur=1.5s）
  waking: { priority: 2, minMs: 0 },
  thinking: { priority: 2, minMs: 300 },
  drag: { priority: 3, minMs: 0 },
  success: { priority: 4, minMs: 1500 },
  working: { priority: 5, minMs: 400 },
  moving: { priority: 5, minMs: 400 },
  organizing: { priority: 5, minMs: 400 },
  building: { priority: 5, minMs: 400 },
  multitask: { priority: 5, minMs: 400 },
  // —— M8 表演动画（AI 通过 set_pet_animation tool 主动触发） ——
  // priority 5（同执行类）= 高于 success/thinking，让动画播完一个 GIF cycle
  // minMs 3500 ≈ 大部分 GIF 一遍循环时长；celebrating 2000 短一点收尾用
  juggling: { priority: 5, minMs: 3500 },
  sweeping: { priority: 5, minMs: 3500 },
  conducting: { priority: 5, minMs: 3500 },
  grooving: { priority: 5, minMs: 3500 },
  celebrating: { priority: 5, minMs: 2000 },
  // v0.4.3+: 新加 2 个 set_pet_animation type
  carrying: { priority: 5, minMs: 3500 }, // 搬东西 / 整理 / "我帮你拿过来"
  ultrathink: { priority: 5, minMs: 5000 }, // 深推理 (Opus adaptive thinking) — 静态 SVG 久一点
  // —— M9-2 瞬态点击反应 ——
  // priority 4（同 success）= 高于 idle/sleep/thinking，低于 multitask 等执行类
  // 不打断 AI 动画但能从 sleep / idle 拉醒；minMs 1200ms 让动画播完。
  poked: { priority: 4, minMs: 1200 },
  looking_around: { priority: 4, minMs: 1500 },
  error: { priority: 6, minMs: 1200 },
  awaiting: { priority: 7, minMs: 0 }
} as const

export type PetState = keyof typeof PET_STATES

/**
 * M8 表演动画 enum —— AI 通过 set_pet_animation tool 主动触发的子集。
 * LLM-flow state（thinking / success / error / idle / sleep）不在这个列表，
 * 由 stream + idleSleepTimer 自动驱动；这里是给 user 直观看的"动起来"。
 */
export type PetAnimation =
  | 'juggling'
  | 'sweeping'
  | 'conducting'
  | 'grooving'
  | 'celebrating'
  | 'carrying' // 搬东西 / 帮忙整理 (v0.4.3+)
  | 'ultrathink' // 深推理 — 静态 SVG, 适合 Opus adaptive thinking 时主动触发 (v0.4.3+)

export const PET_ANIMATIONS: ReadonlyArray<PetAnimation> = [
  'juggling',
  'sweeping',
  'conducting',
  'grooving',
  'celebrating',
  'carrying',
  'ultrathink'
]

export function isPetAnimation(s: string): s is PetAnimation {
  return PET_ANIMATIONS.includes(s as PetAnimation)
}

/**
 * M8: renderer 跨态 GIF cross-fade 单边时长（跟 App.tsx FADE_HALF_MS 对齐）。
 * 给 main 端 scheduleReturnToIdle 加 buffer：动画 minMs 之外多留一个 fade 时长，
 * 否则 fade-in 占用 minMs 起始 ~10% 时段，user 实际看 animation 周期略短。
 */
export const RENDERER_FADE_HALF_MS = 280

/** 类型守卫：判断字符串是否合法状态 ID（用于 IPC 入口防御性校验） */
export function isPetState(s: string): s is PetState {
  return Object.prototype.hasOwnProperty.call(PET_STATES, s)
}
