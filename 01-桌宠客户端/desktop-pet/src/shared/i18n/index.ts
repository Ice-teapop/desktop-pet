/**
 * i18n 主入口 — build-time locale 注入 (electron.vite.config.ts 的 define).
 *
 * 用法:
 *   import { t } from '@shared/i18n'   // 或相对路径
 *   t('tray.show_hide')                 // → '显示 / 隐藏桌宠' (zh) | 'Show / Hide pet' (en)
 *   t('tray.update_check', '0.4.1')     // → '检查更新（当前 v0.4.1）'
 *
 * 设计:
 *  - 单 LOCALE 常量, build 时确定, runtime 不切. EN build 跟 ZH build 是两个独立产物.
 *  - en.ts 必须 satisfies zh.ts 同 shape (TS I18nDict 强制)
 *  - 缺 key fallback 到 zh (开发期容错, 真发布前 typecheck 会报)
 *  - 参数 {0} {1} 简单 split-replace, 不做复数 / gender 等高级 ICU
 */

import { zh, type I18nKey } from './zh'
import { en } from './en'

// electron.vite.config.ts define `__DESKPET_LOCALE__`: 'zh' | 'en' (compile-time const).
// 通过 declare 让 TS 不报错; runtime 由 Vite replace 成 string literal.
declare const __DESKPET_LOCALE__: 'zh' | 'en'

const dict = __DESKPET_LOCALE__ === 'en' ? en : zh

/**
 * 取本地化字符串. key 必须是 zh.ts 已定义的; args 替换 {0} {1} 占位符.
 * 缺 key (理论上 TS 拦下) → fallback 到 zh.
 */
export function t(key: I18nKey, ...args: string[]): string {
  const tmpl = dict[key] ?? zh[key] ?? key
  if (args.length === 0) return tmpl
  return args.reduce<string>((s, v, i) => s.replace(`{${i}}`, v), tmpl)
}

/** 当前 locale — 给少数需要分支判断的地方 (e.g. font-family 选择). */
export const LOCALE: 'zh' | 'en' = __DESKPET_LOCALE__

export type { I18nKey } from './zh'
