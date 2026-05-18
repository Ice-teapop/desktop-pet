/**
 * v0.4.0 改动 4 [B] 动态 listModels — 各 provider 拉真实可用 model 列表 + 24h 缓存.
 *
 * 设计:
 *  - 每个 provider 调对应 listModels endpoint, OpenAI / xAI / DeepSeek 都用
 *    OpenAI compat (Authorization: Bearer + GET /v1/models).
 *  - Anthropic 用专属 endpoint + x-api-key + anthropic-version header.
 *  - Google 用 ?key= query param, 返回 shape 不同 (models[].name).
 *  - ByteDance 没标准 listModels endpoint, 用 hardcoded.
 *  - Cache 24h TTL, 写 userData/available-models-cache.json (per-provider).
 *  - 拉失败 → fallback 到 AVAILABLE_MODELS 硬编码列表 (不让 UI dropdown 变空).
 *
 * 用法:
 *  - getAllAvailableModels(providerKeys) — 并发拉所有已配 provider, 返回 Map.
 *  - getAvailableModels(provider, key, force?) — 单 provider, force=true 跳 cache.
 *
 * 安全:
 *  - API key 仅 main 进程使用, 走 https.fetch (Electron net 暂不用, fetch 已够).
 *  - timeout 10s 防 hang.
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AVAILABLE_MODELS, type Provider } from '../../shared/provider-types'

export interface ProviderModelsCacheEntry {
  models: string[]
  fetchedAt: number
}

type ModelsCache = Partial<Record<Provider, ProviderModelsCacheEntry>>

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILENAME = 'available-models-cache.json'
const FETCH_TIMEOUT_MS = 10_000

function cacheFilePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILENAME)
}

async function loadCache(): Promise<ModelsCache> {
  try {
    const raw = await fs.readFile(cacheFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as ModelsCache
    }
    return {}
  } catch {
    return {}
  }
}

async function saveCache(cache: ModelsCache): Promise<void> {
  try {
    await fs.writeFile(cacheFilePath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[available-models] cache write failed:', err)
  }
}

/** 把硬编码 AVAILABLE_MODELS 转成 per-provider id 列表, 作为 listModels 失败的兜底. */
function fallbackHardcoded(provider: Provider): string[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider).map((m) => m.id)
}

/**
 * v0.4.0 改动 4 - 用户要"同种模型只保留最新的版本".
 * 提取 model 的 family (剥掉版本号 + 日期后缀), 同 family 多个 → 选最新一个.
 *
 * 优先级:
 *  1) 有 canonical alias (无日期后缀) → 用它 (Anthropic/OpenAI 推荐用 alias 自动跟进)
 *  2) 否则字典序 desc 选 max (claude-3-5-sonnet-20241022 > 20240620)
 *
 * 各 provider 命名风格不一致 → 用 per-provider family 提取函数.
 */
function familyOf(provider: Provider, id: string): string {
  switch (provider) {
    case 'anthropic':
      // claude-opus-4-7 → claude-opus  (按 family: opus/sonnet/haiku)
      // claude-3-5-sonnet-20241022 → claude-3-5-sonnet (legacy 命名)
      return id
        .replace(/-\d{8}$/, '') // claude-3-5-sonnet-20241022 → claude-3-5-sonnet
        .replace(/-\d+-\d+$/, '') // claude-opus-4-7 → claude-opus
    case 'openai':
      // gpt-4o-2024-08-06 → gpt-4o, gpt-4o-mini 保留独立 family
      return id.replace(/-\d{4}-\d{2}-\d{2}$/, '')
    case 'google':
      // gemini-1.5-pro-001 → gemini-1.5-pro
      return id.replace(/-\d{3,}$/, '')
    case 'xai':
      // grok-2-1212 → grok-2, grok-vision-beta 保留
      return id.replace(/-\d{4}$/, '')
    case 'deepseek':
    case 'bytedance':
    default:
      // 无统一版本规则 → family = id (不 dedupe)
      return id
  }
}

function dedupeKeepLatest(provider: Provider, models: string[]): string[] {
  const groups = new Map<string, string[]>()
  for (const id of models) {
    const fam = familyOf(provider, id)
    const arr = groups.get(fam) ?? []
    arr.push(id)
    groups.set(fam, arr)
  }
  const result: string[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }
    // 1) prefer canonical (无日期后缀)
    const canonical = group.find(
      (g) => !/-\d{8}$/.test(g) && !/-\d{4}-\d{2}-\d{2}$/.test(g)
    )
    if (canonical) {
      result.push(canonical)
      continue
    }
    // 2) fallback: lex desc (最新日期 / 最大版本号)
    result.push([...group].sort().reverse()[0])
  }
  return result
}

/** fetch with timeout — Node 20 / undici default has 5min timeout, 10s 足够 listModels. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function fetchAnthropicModels(key: string): Promise<string[]> {
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=50', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    }
  })
  if (!r.ok) throw new Error(`Anthropic listModels HTTP ${r.status}`)
  const j = (await r.json()) as { data?: Array<{ id: string }> }
  return (j.data ?? []).map((m) => m.id).filter((id) => id.startsWith('claude-'))
}

async function fetchOpenAICompatModels(key: string, url: string): Promise<string[]> {
  const r = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${key}` }
  })
  if (!r.ok) throw new Error(`listModels HTTP ${r.status}`)
  const j = (await r.json()) as { data?: Array<{ id: string }> }
  return (j.data ?? []).map((m) => m.id)
}

async function fetchOpenAIModels(key: string): Promise<string[]> {
  const ids = await fetchOpenAICompatModels(key, 'https://api.openai.com/v1/models')
  // 过滤掉非 chat model (embed / whisper / tts / dall-e / moderation / image / search / audio)
  // 保留 gpt-* + o\d-* (推理) + chatgpt-* 等
  return ids
    .filter((id) => /^(gpt|o\d|chatgpt|codex)/i.test(id))
    .filter((id) => !/(embed|whisper|tts|moderation|dall-e|image-|search|audio|realtime|vision-preview)/i.test(id))
}

async function fetchXaiModels(key: string): Promise<string[]> {
  const ids = await fetchOpenAICompatModels(key, 'https://api.x.ai/v1/models')
  return ids.filter((id) => /grok/i.test(id))
}

async function fetchDeepseekModels(key: string): Promise<string[]> {
  const ids = await fetchOpenAICompatModels(key, 'https://api.deepseek.com/v1/models')
  return ids.filter((id) => /^deepseek/i.test(id))
}

async function fetchGoogleModels(key: string): Promise<string[]> {
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    { method: 'GET' }
  )
  if (!r.ok) throw new Error(`Google listModels HTTP ${r.status}`)
  const j = (await r.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
  return (j.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((id) => /gemini/i.test(id))
}

/** 单 provider 拉. force=true 跳 cache. 拉失败 fallback 到 AVAILABLE_MODELS. */
export async function getAvailableModels(
  provider: Provider,
  key: string,
  force = false
): Promise<string[]> {
  const cache = await loadCache()
  const cached = cache[provider]
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models
  }
  let models: string[]
  try {
    switch (provider) {
      case 'anthropic':
        models = await fetchAnthropicModels(key)
        break
      case 'openai':
        models = await fetchOpenAIModels(key)
        break
      case 'google':
        models = await fetchGoogleModels(key)
        break
      case 'xai':
        models = await fetchXaiModels(key)
        break
      case 'deepseek':
        models = await fetchDeepseekModels(key)
        break
      case 'bytedance':
        // 火山引擎没标准 listModels endpoint, 用硬编码
        models = fallbackHardcoded(provider)
        break
      default:
        models = fallbackHardcoded(provider)
    }
    if (models.length === 0) {
      console.warn(`[available-models] ${provider} returned 0 models, fallback to hardcoded`)
      models = fallbackHardcoded(provider)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[available-models] ${provider} listModels failed:`, msg, '— fallback to hardcoded')
    models = fallbackHardcoded(provider)
  }
  // 改动 4: 同 family 只留最新一个 (用户要"同种模型只保留最新的版本")
  models = dedupeKeepLatest(provider, models)
  cache[provider] = { models, fetchedAt: Date.now() }
  void saveCache(cache)
  return models
}

/** 并发拉所有已配 provider 的 model 列表. 返回 Map<Provider, string[]>. */
export async function getAllAvailableModels(
  providerKeys: Map<Provider, string>
): Promise<Map<Provider, string[]>> {
  const result = new Map<Provider, string[]>()
  await Promise.all(
    Array.from(providerKeys.entries()).map(async ([p, key]) => {
      const models = await getAvailableModels(p, key)
      result.set(p, models)
    })
  )
  return result
}

/** 仅返回当前 cache, 不触发 fetch — 用于 UI 启动时立刻 render (有的话). */
export async function getCachedAvailableModels(): Promise<Map<Provider, string[]>> {
  const cache = await loadCache()
  const result = new Map<Provider, string[]>()
  for (const [p, entry] of Object.entries(cache)) {
    if (entry && Array.isArray(entry.models)) {
      result.set(p as Provider, entry.models)
    }
  }
  return result
}
