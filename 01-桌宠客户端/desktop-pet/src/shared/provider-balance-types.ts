/**
 * Provider 余额查询返回类型 — shared 给 main / preload / renderer.
 *
 * Discriminated union 让 renderer 用 kind switch 渲染:
 *  - 'ok'          → 显示金额 + 货币 + last fetch time
 *  - 'unsupported' → 显示"用官方面板查"链接 (provider 没公开 API)
 *  - 'error'       → 显示错误 + 重试按钮
 *
 * Implementation 在 main/llm/provider-balance.ts; renderer 通过
 * `window.api.fetchProviderBalance(provider)` 调.
 */

import type { Provider } from './provider-types'

export type ProviderBalance =
  | {
      kind: 'ok'
      provider: Provider
      /** 显示用 — "$10.50 USD" 或 "¥42.31 CNY" */
      label: string
      /** 数值, 浮点. 用户对 < 0.01 即将耗尽这件事敏感 */
      total: number
      currency: string
      /** Unix ms — renderer 可显示 "5min ago" */
      fetchedAt: number
    }
  | {
      kind: 'unsupported'
      provider: Provider
      /** 引导用户去看官方面板的理由文案 */
      reason: string
    }
  | {
      kind: 'error'
      provider: Provider
      message: string
    }
