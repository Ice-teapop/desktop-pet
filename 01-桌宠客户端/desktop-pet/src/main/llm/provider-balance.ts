/**
 * Provider 余额 / 用量查询 (M? 改动 5 [#5]).
 *
 * 现实: 大部分 provider 没公开 balance/usage API:
 *  - Anthropic: 无 (Console 网页可查)
 *  - OpenAI: /v1/organization/usage 要 Admin key, 普通 API key 不行
 *  - Google: Cloud Billing API 要 service account
 *  - xAI: 无文档
 *  - **DeepSeek: GET /user/balance 公开, 普通 API key 即可** ← 唯一能做的
 *  - ByteDance: 火山引擎需主账号 access key, 不是方舟 API key
 *
 * 当前实现: 只 DeepSeek 真查; 其他 provider 让 renderer 引导用户去
 * `usageDashboardUrl` 打开官方面板.
 *
 * 未来扩展: OpenAI 用户如有 Admin key 可加 opt-in 路径, 见 deferred list.
 */

import type { Provider } from '../../shared/provider-types'
import type { ProviderBalance } from '../../shared/provider-balance-types'

export type { ProviderBalance } from '../../shared/provider-balance-types'

const FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

interface DeepseekBalanceResponse {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }>
}

async function fetchDeepseekBalance(key: string): Promise<ProviderBalance> {
  try {
    const r = await fetchWithTimeout('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (!r.ok) {
      return {
        kind: 'error',
        provider: 'deepseek',
        message: `HTTP ${r.status}`
      }
    }
    const data = (await r.json()) as DeepseekBalanceResponse
    const first = data.balance_infos?.[0]
    if (!first) {
      return { kind: 'error', provider: 'deepseek', message: 'empty response' }
    }
    const total = parseFloat(first.total_balance ?? '0')
    const currency = first.currency ?? 'USD'
    const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
    return {
      kind: 'ok',
      provider: 'deepseek',
      label: `${symbol}${total.toFixed(2)} ${currency}`,
      total,
      currency,
      fetchedAt: Date.now()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'error', provider: 'deepseek', message: msg }
  }
}

/**
 * 主入口 — main 进程 IPC 调. 不支持的 provider 返 'unsupported' kind.
 */
export async function fetchProviderBalance(
  provider: Provider,
  key: string
): Promise<ProviderBalance> {
  switch (provider) {
    case 'deepseek':
      return fetchDeepseekBalance(key)
    case 'anthropic':
      return {
        kind: 'unsupported',
        provider,
        reason: 'Anthropic 无公开余额 API — 在 Console 查'
      }
    case 'openai':
      return {
        kind: 'unsupported',
        provider,
        reason: 'OpenAI /v1/usage 需 Admin key — 普通 key 不支持'
      }
    case 'google':
      return {
        kind: 'unsupported',
        provider,
        reason: 'Google Billing 需 service account — 在 AI Studio 查'
      }
    case 'xai':
      return {
        kind: 'unsupported',
        provider,
        reason: 'xAI 无公开余额 API — 在 Console 查'
      }
    case 'bytedance':
      return {
        kind: 'unsupported',
        provider,
        reason: '火山引擎需主账号 access key — 在火山控制台查'
      }
    default: {
      const exhaustive: never = provider
      throw new Error(`unhandled provider: ${String(exhaustive)}`)
    }
  }
}
