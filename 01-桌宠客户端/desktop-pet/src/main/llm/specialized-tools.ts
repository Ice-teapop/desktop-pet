/**
 * Wave 6 (M7-6): 各 provider 原生 server-side specialized tool 集成。
 *
 * 跟 18 个本地 agentic tool（tool-defs.ts 的 buildToolSetForContext）**平行存在** ——
 * AI 看到的 ToolSet = 「本地通用 18 + 当前 provider 原生 N」的并集。AI 自己挑哪个
 * 最适合用：
 *   - 查最新数据：Anthropic 模型可能选 anthropic_web_search 而非走 Tavily web_search
 *   - 跑 Python：openai_code_interpreter / anthropic_code_execution 走 provider 沙箱
 *     而非用 run_command 在 user 本机执行（安全 + 隔离）
 *   - DeepSeek 没原生 web search → 只能用 Tavily web_search（如果 user 配了）
 *
 * 默认开启每家最有价值的 native tool —— user 不需要单独 enable 各 provider 各
 * tool；装好那个 provider 的 key 就能用。
 *
 * 安全考虑：
 *  - server-side tool 完全在 provider 那边运行，**不经过我们的 path-safety /
 *    approval modal / audit log 系统**。这是必要的语义 trade-off：
 *      * anthropic codeExecution / openai codeInterpreter: 沙箱 in provider's
 *        infrastructure，跟 user filesystem 隔离 —— 比 run_command 更安全
 *      * 各家 webSearch: 检索 query 发到 provider 后端 —— 我们看不到具体内容，
 *        但 provider 看到（user 选 provider 时已暗含信任）
 *  - 这 trade-off 跟我们 fetch_url SSRF 防御不冲突（那是给本地 fetch 用的）
 *  - tool name 用 `<provider>_<feature>` 命名空间避免跟 18 个本地 tool 撞名
 *
 * 怎么发现新功能：
 *  - 跑 `node -e "console.log(Object.keys(require('@ai-sdk/<X>').<provider>.tools))"`
 *  - 看 https://github.com/vercel/ai/releases 各 provider 包的 changelog
 *  - 看官方 docs：anthropic.com / platform.openai.com / ai.google.dev / docs.x.ai
 */
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { xaiTools } from '@ai-sdk/xai'
import type { ToolSet } from 'ai'
import type { Provider } from '../../shared/provider-types'

/**
 * 给定 provider，返回该 provider 的 specialized server-side tool 集（dynamic
 * 每 turn 调一次）。DeepSeek / ByteDance 当前无 native server tool 暴露给
 * @ai-sdk/*，返回空对象。
 *
 * Tool 选型原则：每家选 1-2 个 high-value 不重复的能力。完整暴露面见文件头注释。
 */
export function buildSpecializedToolsForProvider(provider: Provider): ToolSet {
  switch (provider) {
    case 'anthropic':
      return {
        // 原生联网（比走 Tavily 经 fetch_url 更直接 + Claude trained on 这个 tool 格式）
        // maxUses 防一轮调用爆 token
        anthropic_web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }),
        // Anthropic 沙箱跑 Python，不在 user 本机跑 —— 跟 run_command 隔离更安全
        anthropic_code_execution: anthropic.tools.codeExecution_20260120({})
      }
    case 'openai':
      return {
        // GPT-4o 原生 web search（webSearchPreview = stable interface）
        openai_web_search: openai.tools.webSearchPreview({}),
        // OpenAI 沙箱跑 Python
        openai_code_interpreter: openai.tools.codeInterpreter({})
      }
    case 'google':
      return {
        // Google Search grounding —— 比 Tavily / 其它 web search 更权威，附 citation
        google_search: google.tools.googleSearch({}),
        // 解析任意 URL 内容 —— 比 fetch_url 更结构化（不限 SSRF 因 Google 后端跑）
        google_url_context: google.tools.urlContext({})
      }
    case 'xai':
      return {
        // 独家 ⭐：实时 X (Twitter) feed search —— 其它 provider 无法获取的新数据源
        xai_live_search: xaiTools.xSearch({}),
        // 一般 web search
        xai_web_search: xaiTools.webSearch({})
      }
    case 'deepseek':
      // DeepSeek 无 native server tool 暴露给 @ai-sdk/deepseek。
      // R1 model 的 <think>...</think> reasoning block 通过 model middleware 提取
      //（见 providers.ts 的 wrapLanguageModel + extractReasoningMiddleware）
      return {}
    case 'bytedance':
      // ByteDance 豆包当前 @ai-sdk/bytedance 不暴露 native server tool。
      // 走 ToolSet 18 通用 tool + tavily（若有 key）已够用
      return {}
    default: {
      // exhaustive check —— 加 provider 时 TS 强制这里加分支
      const exhaustive: never = provider
      throw new Error(`unhandled provider: ${String(exhaustive)}`)
    }
  }
}
