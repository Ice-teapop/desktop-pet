/**
 * 桌宠顶层 mode（M9-5 mini mode 引入）—— 跟 PetState 正交。
 *
 * 'full': 桌宠完整尺寸 240×240（在窗口 260×280 内），跑常规 idle / thinking
 *         / sleeping 等所有 PetState 动画。chat / settings 都基于这个 mode.
 *
 * 'mini': 桌宠缩到 80×80，藏在屏幕右边缘（仅 24px 露出）做 peek / 通知 / 完成
 *         等迷你动画。clicking restores to 'full'.
 *
 * petMode 跟 PetState 的关系：
 *   - PetState（idle / thinking / juggling / etc）描述"pet 在干什么"
 *   - PetMode（full / mini）描述"pet 怎么呈现"
 *   - 两个维度独立：mini mode 的 idle 用 mini-idle GIF；full mode 的 idle 用
 *     Furina idle sprite。renderer 据 petMode 走不同 render path。
 */
export type PetMode = 'full' | 'mini'

/** 默认 mode —— app 启动默认 full，user 拖到边或托盘切换 mini */
export const DEFAULT_PET_MODE: PetMode = 'full'

export function isPetMode(s: string): s is PetMode {
  return s === 'full' || s === 'mini'
}

/** Mini mode 窗口尺寸（CSS `.pet-mini` 让 pet body 撑满 100×100 window，无 padding） */
export const MINI_WIN_WIDTH = 100
export const MINI_WIN_HEIGHT = 100
/** Mini mode 默认露出多少 px（设计师 v2: 24→32，露出角色一部分，用户余光可见
 *  仍明确"贴边" + hit-test 横向 32px 远高于 Fitts 安全线 12px。100 - 32 = 68px 藏屏外） */
export const MINI_VISIBLE_PX = 32
/** Drag 时窗口在屏内的最小可见宽度（drag clamp 下限）—— 防全藏屏外让用户找不到
 *  grab handle。与 MINI_SNAP_VISIBLE_PX 是同轴两阈值：必须 DRAG_MIN < SNAP，
 *  否则物理上达不到 snap 触发带，snap 永远不会 fire。 */
export const DRAG_MIN_VISIBLE_PX = 40
/** Drag end 时窗口在屏内的可见宽度阈值 —— ≤ 此值触发 snap to mini。
 *  panel 窗口宽 260px (pet body 240 + padding 20)，180px ≈ panel 的 69% 可见 /
 *  31% 推出屏。用户只需"明显往右推一下"就 snap，不必拖到几乎完全出屏。
 *  历史: v0.4.0 首版 60 太严格 (触发带仅 20px 几乎拖不出); 100 仍不够激进
 *  (用户反馈"还是不行"); 180 触发带 140px (40-180), 手感跟桌宠"边缘收纳" UX 对齐。 */
export const MINI_SNAP_VISIBLE_PX = 180

// —— M9-5b B-4 Hover peek ——
/** mini panel 露出更多以便预览：peek 状态露 80px（vs retract 32px / micro 64px） */
export const MINI_PEEK_VISIBLE_PX = 80
/** Hysteresis 进入 peek：cursor 到 mini 中心距离 < 这个值 → 触发 peek */
export const MINI_PEEK_ENTER_DIST = 80
/** Hysteresis 撤离 peek：cursor 到 mini 中心距离 > 这个值 → 收回 retract
 *  Leave > Enter 防 cursor 在阈值附近震荡导致 peek/retract 反复切 */
export const MINI_PEEK_LEAVE_DIST = 130
/** 平滑插值系数：每帧靠近 target_x 该比例 —— 0.3 给"快速但不僵硬"手感 */
export const MINI_PEEK_LERP = 0.3
/** 距 target ≤ 1px 时 snap，省剩余浮点 setBounds */
export const MINI_PEEK_SNAP_PX = 1
/** Peek watcher 轮询间隔 —— 30Hz 跟 cursorPollTimer 一致 */
export const MINI_PEEK_POLL_MS = 33

// —— M9-5b B-5c 周期性 micro-peek（mini panel 自己周期性探头, 即使用户不靠近也有"活着"信号）——
/** micro-peek 露出量 —— 介于默认 32 跟 hover-peek 80 之间，各 16px 区分度 */
export const MINI_MICRO_PEEK_VISIBLE_PX = 64
/** micro-peek 周期 —— 平均每 4 秒来一次 (用户调) */
export const MINI_MICRO_PEEK_PERIOD_MS = 4000
/** ± jitter, 防机械感 → 实际间隔 3-5 秒随机 */
export const MINI_MICRO_PEEK_JITTER_MS = 1000
/** 到达 micro-peek 位置后 hold 多久才开始收回 */
export const MINI_MICRO_PEEK_HOLD_MS = 600
/** micro-peek 期间用的较慢 lerp（vs hover-peek 0.3）—— 0.07 给"探头犹豫"手感
 *  数学: delta=16, 0.93^N < 1/16 → N≈38 frames @ 33ms = 1.26s 收敛, 接近设计师的 1200ms ease-out */
export const MINI_MICRO_PEEK_LERP = 0.07
