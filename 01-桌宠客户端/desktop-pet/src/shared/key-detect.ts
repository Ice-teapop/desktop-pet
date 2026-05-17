/**
 * Provider 识别 —— 从 API key 文本前缀 / 格式推断属于哪个 provider.
 *
 * 用于"粘 key 自动识别"onboarding 流程: 用户在 chat 框第一次粘任意 provider 的 key,
 * 这里识别后直接 submitProviderKey(detected, key) + setSelectedModel, 不再
 * Anthropic-biased UX (历史 looksLikeApiKey 只认 sk-ant-).
 *
 * sk- 前缀在 OpenAI / DeepSeek 之间存在歧义 —— 返回 ambiguous 让 UI 给 hint
 * 让用户在设置里区分; 我们 default 走 OpenAI (更常见). 用户首次请求失败拿到
 * 401 后可以去 Settings 手切到 DeepSeek.
 */
import type { Provider } from './provider-types'

export type DetectResult =
  | { kind: 'detected'; provider: Provider }
  | { kind: 'ambiguous'; candidates: Provider[]; defaultPick: Provider }
  | { kind: 'unknown' }

export function detectProvider(rawKey: string): DetectResult {
  // 去 trim + 剥常见复制污染 (Bearer / "key=" / 引号)
  const k = rawKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^key\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')

  if (!k) return { kind: 'unknown' }

  // 强前缀 (唯一 provider)
  if (/^sk-ant-[\w-]{20,200}$/.test(k)) return { kind: 'detected', provider: 'anthropic' }
  if (/^xai-[\w-]{20,200}$/.test(k)) return { kind: 'detected', provider: 'xai' }
  if (/^AIza[\w-]{30,40}$/.test(k)) return { kind: 'detected', provider: 'google' }
  if (/^sk-proj-[\w-]+$/.test(k)) return { kind: 'detected', provider: 'openai' } // 新 OpenAI 项目 key

  // ByteDance Volcano Ark: UUID 形式 36 字符 (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
    return { kind: 'detected', provider: 'bytedance' }
  }

  // 歧义 sk-: OpenAI 跟 DeepSeek 撞前缀. 默认猜 OpenAI (用户基数大).
  if (/^sk-[\w-]{20,200}$/.test(k)) {
    return { kind: 'ambiguous', candidates: ['openai', 'deepseek'], defaultPick: 'openai' }
  }

  return { kind: 'unknown' }
}

/** 简易格式校验 —— 任何已知 provider 的 key 形式都返回 true */
export function looksLikeAnyApiKey(rawKey: string): boolean {
  return detectProvider(rawKey).kind !== 'unknown'
}
