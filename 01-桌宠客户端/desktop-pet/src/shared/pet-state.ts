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
  sleep: { priority: 1, minMs: 0 },
  thinking: { priority: 2, minMs: 300 },
  drag: { priority: 3, minMs: 0 },
  success: { priority: 4, minMs: 1500 },
  working: { priority: 5, minMs: 400 },
  moving: { priority: 5, minMs: 400 },
  organizing: { priority: 5, minMs: 400 },
  building: { priority: 5, minMs: 400 },
  multitask: { priority: 5, minMs: 400 },
  error: { priority: 6, minMs: 1200 },
  awaiting: { priority: 7, minMs: 0 }
} as const

export type PetState = keyof typeof PET_STATES

/** 类型守卫：判断字符串是否合法状态 ID（用于 IPC 入口防御性校验） */
export function isPetState(s: string): s is PetState {
  return Object.prototype.hasOwnProperty.call(PET_STATES, s)
}
