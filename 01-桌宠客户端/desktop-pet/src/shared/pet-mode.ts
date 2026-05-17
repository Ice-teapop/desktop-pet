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
 *     eye-following SVG。renderer 据 petMode 走不同 render path。
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
/** Mini mode 露出屏外多少 px（80 - 24 = 56px 藏在屏外） */
export const MINI_VISIBLE_PX = 24
/** Drag end 检测：右边离 workArea.right 这个距离内 → 触发 snap to mini。
 *  60px 比 40 宽容 —— pointerup 时 pet 通常离右边 30-80px（rendererDelta 末帧 +
 *  setPosition latency），主观"我拖到边了"该触发，40px 太严容易 miss. */
export const MINI_SNAP_THRESHOLD_PX = 60
