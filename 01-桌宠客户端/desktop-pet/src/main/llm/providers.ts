/**
 * Vercel AI SDK provider registry —— 把 SelectedModel 路由到对应 SDK 的 model factory。
 *
 * AI SDK ProviderV3 spec：
 *   import { createAnthropic } from '@ai-sdk/anthropic'
 *   const anthropic = createAnthropic({ apiKey: '...' })
 *   const model = anthropic.languageModel('claude-haiku-4-5')
 *   await streamText({ model, ... })
 *
 * 注意：5/6 个 provider 也允许直接 callable 形式（anthropic(id)），但 ByteDance
 * provider 不可 call，必须走 .languageModel(id)。这里统一 spec 写法保证一致。
 *
 * key 由 provider-keys storage 解析（env 优先 + 落盘兜底）。
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createByteDance } from '@ai-sdk/bytedance'
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from 'ai'
import type { Provider, SelectedModel } from '../../shared/provider-types'
import { resolveProviderKey } from '../storage/provider-keys'

/**
 * 用 provider 对应的 SDK factory 实例化 LanguageModel。
 * apiKey 由调用方从 storage 拿来传入。
 */
function instantiateModel(
  provider: Provider,
  apiKey: string,
  modelId: string
): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey }).languageModel(modelId)
    case 'openai':
      return createOpenAI({ apiKey }).languageModel(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey }).languageModel(modelId)
    case 'xai':
      return createXai({ apiKey }).languageModel(modelId)
    case 'deepseek': {
      const baseModel = createDeepSeek({ apiKey }).languageModel(modelId)
      // M7-6 wave 6: DeepSeek-R1 reasoner 返回 <think>...</think> block
      // 在主 content 里。用 extractReasoningMiddleware 把 reasoning 单独提到
      // ReasoningPart 让上层（renderer）能区分显示推理过程 vs 最终答案。
      // V3 (deepseek-chat) 不是 reasoning model，不包 middleware。
      if (modelId === 'deepseek-reasoner') {
        return wrapLanguageModel({
          model: baseModel,
          middleware: extractReasoningMiddleware({ tagName: 'think' })
        })
      }
      return baseModel
    }
    case 'bytedance':
      return createByteDance({ apiKey }).languageModel(modelId)
    default: {
      // exhaustive check —— 加 provider 时 TS 强制这里加分支
      const exhaustive: never = provider
      throw new Error(`unhandled provider: ${String(exhaustive)}`)
    }
  }
}

/**
 * 根据 SelectedModel 解析出可调用的 LanguageModel 实例。
 * key 不存在 → null（上层应当转 'no-api-key' 错给 UI）。
 */
export async function resolveLanguageModel(
  selected: SelectedModel
): Promise<LanguageModel | null> {
  const apiKey = await resolveProviderKey(selected.provider)
  if (!apiKey) return null
  return instantiateModel(selected.provider, apiKey, selected.modelId)
}

/**
 * 同步版本（已知 apiKey 时不重新读盘）—— 用于 chat:submit 已经先取 key 校验
 * 后再实例化的场景，避免重复 IO。
 */
export function instantiateModelSync(
  provider: Provider,
  apiKey: string,
  modelId: string
): LanguageModel {
  return instantiateModel(provider, apiKey, modelId)
}
