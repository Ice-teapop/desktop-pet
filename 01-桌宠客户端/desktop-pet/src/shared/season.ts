/**
 * v0.4.0 [E] 季节 / 节日 / 时段判定 — 纯函数, main + renderer 共用.
 *
 * 不依赖外部 lib (no chinese-lunar-calendar npm 暂时), 阳历日期硬编码节日.
 * 用户生日字段从 UserProfile.birthday (ISO 'YYYY-MM-DD') 传入.
 *
 * outfit emoji fallback: 美术 PNG 资产没就位前用 emoji 占位.
 *
 * 调用点:
 * - main 端 startup + powerMonitor resume + 每天 0:05 cron 推 'pet:season-context'
 * - renderer 收到后 setOutfit(state.outfit) 在 pet-outfit overlay 显示 emoji
 *
 * 测试:
 * - getSeasonalContext(new Date('2026-12-25')) → { festival:'christmas', outfit:'🎅', ... }
 * - getSeasonalContext(new Date('2026-10-31')) → { festival:'halloween', outfit:'🎃', ... }
 */

export type Festival =
  | 'christmas' // 12-25
  | 'halloween' // 10-31
  | 'new-year' // 01-01
  | 'qixi' // 七夕 阴历 仅占位, 未实现 lunar
  | 'mid-autumn' // 中秋 阴历 占位
  | 'spring-festival' // 春节 阴历 占位

export type Period =
  | 'late-night' // 0-5
  | 'morning' // 5-8
  | 'noon' // 11-13
  | 'afternoon' // 13-17
  | 'evening' // 17-19
  | 'night' // 19-23
  | 'general' // 8-11 工作时段

/** outfit 标识符 — 用 emoji 直接表示, 也是后续 PNG 文件名前缀 */
export type Outfit = '🎅' | '🎃' | '🎂' | '🌸' | '🍁' | '❄️' | null

export interface SeasonalContext {
  festival: Festival | null
  period: Period
  isBirthday: boolean
  outfit: Outfit
  /** 用户可见 hint, msg-system 气泡用 */
  hint: string | null
}

/**
 * 主接口 — 给当前时间 + 可选 birthday, 返回当前生效的 outfit + festival + period.
 *
 * @param now 当前 Date
 * @param birthday 可选 'YYYY-MM-DD' or 'MM-DD' (年份忽略, 只匹配月日)
 */
export function getSeasonalContext(now: Date, birthday?: string): SeasonalContext {
  const m = now.getMonth() + 1 // 1-12
  const d = now.getDate()
  const h = now.getHours()

  // —— 节日判定 (阳历, 优先级 birthday > 节日 > 季节背景) ——
  let festival: Festival | null = null
  let outfit: Outfit = null
  let hint: string | null = null

  if (m === 12 && d === 25) {
    festival = 'christmas'
    outfit = '🎅'
    hint = '圣诞快乐 🎄 给你戴了顶帽子'
  } else if (m === 10 && d === 31) {
    festival = 'halloween'
    outfit = '🎃'
    hint = '万圣节! 小心我突然跳出来吓你 🎃'
  } else if (m === 1 && d === 1) {
    festival = 'new-year'
    outfit = '❄️'
    hint = '新年快乐! 🎊'
  } else if (m === 3 || m === 4) {
    // 阳历春季 (3-4 月) — 樱花占位 (无具体节日时的季节背景)
    outfit = '🌸'
  } else if (m === 10 || m === 11) {
    // 阳历秋季 — 落叶
    outfit = '🍁'
  } else if (m === 12 || m === 1 || m === 2) {
    // 阳历冬季 — 雪花
    outfit = '❄️'
  }

  // —— 生日判定 (覆盖节日 outfit, 因为对用户更重要) ——
  let isBirthday = false
  if (birthday) {
    // 接受 'YYYY-MM-DD' or 'MM-DD'
    const match = birthday.match(/(\d{1,2})-(\d{1,2})$/)
    if (match) {
      const bm = Number(match[1])
      const bd = Number(match[2])
      if (bm === m && bd === d) {
        isBirthday = true
        outfit = '🎂'
        hint = '生日快乐! 🎂 我特意戴了生日帽给你'
      }
    }
  }

  // —— 时段判定 ——
  let period: Period
  if (h >= 0 && h < 5) period = 'late-night'
  else if (h < 8) period = 'morning'
  else if (h < 11) period = 'general'
  else if (h < 13) period = 'noon'
  else if (h < 17) period = 'afternoon'
  else if (h < 19) period = 'evening'
  else if (h < 23) period = 'night'
  else period = 'late-night'

  return { festival, period, isBirthday, outfit, hint }
}

// —— Smoke test —— 跑 npm run typecheck 时 ts 编译会执行 (dev-only assertion)
// Comment out / 不导出到 prod bundle (tree-shake 删).
// 在浏览器 / Node 都能跑.
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
  const r1 = getSeasonalContext(new Date(2026, 11, 25, 14)) // 2026-12-25 14:00
  console.assert(r1.festival === 'christmas', 'christmas detection failed')
  console.assert(r1.outfit === '🎅', 'santa hat fallback failed')

  const r2 = getSeasonalContext(new Date(2026, 9, 31, 22)) // 2026-10-31 22:00
  console.assert(r2.festival === 'halloween', 'halloween detection failed')
  console.assert(r2.period === 'night', 'period night failed')

  const r3 = getSeasonalContext(new Date(2026, 4, 15, 3), '05-15') // 生日重合
  console.assert(r3.isBirthday === true, 'birthday detection failed')
  console.assert(r3.outfit === '🎂', 'birthday outfit override failed')
  console.assert(r3.period === 'late-night', 'late-night period failed')

  const r4 = getSeasonalContext(new Date(2026, 6, 15, 12)) // 7月 中午, 无节日
  console.assert(r4.festival === null, 'no festival in july')
  console.assert(r4.outfit === null, 'no outfit in july (summer 占位 not added)')
  console.assert(r4.period === 'noon', 'period noon failed')
}
