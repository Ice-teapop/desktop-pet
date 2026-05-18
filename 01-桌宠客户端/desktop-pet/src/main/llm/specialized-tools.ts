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
import type { SelectedModel } from '../../shared/provider-types'

// —— Anthropic native server-side tools 兼容性 ————————————————————————
//
// 这两个 native tool 仅 Opus 4.5+ / Sonnet 4.5+ 支持；Haiku 4.5 装上会让
// API 拒整个请求 → 0 step → AI SDK 'No output generated' (M8 hotfix bug)。
// 不支持的模型走 18 本地 tool + Tavily 已够用。
//
// 设计取舍 (tester 报告):
// - **黑名单 vs 白名单**：真实白名单需要逐月跟 provider 文档对齐，仓库里维护
//   滞后于上游发版。当前用 family-prefix 黑名单——AI 厂商命名通常稳定 (haiku/
//   opus/sonnet 跨版本一致)，新出 mid-tier 时再扩名单。
// - **不依赖完整 modelId**：modelId 含日期 (claude-haiku-4-5-20251001) 容易漂移
//   ，改用 family substring (`haiku`) 鲁棒性更高。
// - **未实现**：真正版本号比对 (Haiku 5 出来若支持需手动更新)。这是 follow-up。
const ANTHROPIC_NATIVE_TOOL_BLOCKED_FAMILIES = ['haiku'] as const

/** true = 该 modelId 支持 anthropic_web_search / anthropic_code_execution */
function supportsAnthropicNativeTools(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return !ANTHROPIC_NATIVE_TOOL_BLOCKED_FAMILIES.some((fam) => lower.includes(fam))
}

/** Anthropic native web_search 单次会话内最大调用次数。
 *  超过 → provider 强制停止；user 不知道有此 cap。
 *  当前硬编码 5 —— provider 默认值，复杂研究流可能不够 (tester 报告 LOW)。
 *  暴露成 const 便于以后做成 prefs 或按 turn 动态调。*/
const ANTHROPIC_WEB_SEARCH_MAX_USES = 5

// ⚠️ 计费透明度 (tester 报告 MED): Anthropic / OpenAI / Google / xAI native
// tool 走 provider 按 token 计费, 用户无 UI 提示。Tavily 反而按 quota 透明。
// follow-up: chat 顶部加 native-tool 触发徽章 + 一次性 "what this costs" toast。

// —— OpenAI native tools 兼容性 ————————————————————————————————————
//
// openai.tools.webSearchPreview / codeInterpreter 只在 GPT-4o 家族 chat
// completion 端点上稳定。注入到 legacy completions (`gpt-3.5-turbo-instruct*`)
// / o-series reasoning model 等会让 OpenAI API 拒整个请求 → SDK 抛
// AI_NoOutputGeneratedError → classifier 归类为 'empty-response' → 触发
// fallback 到 Anthropic, 用户看到误导性"过载"提示。这是用户 2026-05-19
// 报"openai 输入完之后还是没有用"的根因。
//
// 跟 Anthropic 同 pattern: 白名单 family prefix, 不在名单里的不注入 native tool
// (走纯 18 本地 tool + Tavily 已够用)。白名单保守 — 列入实测 webSearchPreview /
// codeInterpreter 支持的 family; o-series / 3.5 / 4-turbo / 旧 davinci 等都不
// 注入 (provider 文档对 server-side tool 支持矩阵更新滞后, 仓库内白名单跟不上)。
const OPENAI_NATIVE_TOOL_ALLOWED_FAMILIES = ['gpt-4o', 'gpt-4.1'] as const

/** true = 该 modelId 支持 openai_web_search / openai_code_interpreter */
function supportsOpenAINativeTools(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return OPENAI_NATIVE_TOOL_ALLOWED_FAMILIES.some((fam) => lower.includes(fam))
}

/**
 * 给定 provider，返回该 provider 的 specialized server-side tool 集（dynamic
 * 每 turn 调一次）。DeepSeek / ByteDance 当前无 native server tool 暴露给
 * @ai-sdk/*，返回空对象。
 *
 * Tool 选型原则：每家选 1-2 个 high-value 不重复的能力。完整暴露面见文件头注释。
 */
export function buildSpecializedToolsForProvider(selected: SelectedModel): ToolSet {
  switch (selected.provider) {
    case 'anthropic': {
      const tools: ToolSet = {}
      if (supportsAnthropicNativeTools(selected.modelId)) {
        tools.anthropic_web_search = anthropic.tools.webSearch_20260209({
          maxUses: ANTHROPIC_WEB_SEARCH_MAX_USES
        })
        tools.anthropic_code_execution = anthropic.tools.codeExecution_20260120({})
      }
      return tools
    }
    case 'openai': {
      const tools: ToolSet = {}
      if (supportsOpenAINativeTools(selected.modelId)) {
        // GPT-4o 原生 web search（webSearchPreview = stable interface）
        tools.openai_web_search = openai.tools.webSearchPreview({})
        // OpenAI 沙箱跑 Python
        tools.openai_code_interpreter = openai.tools.codeInterpreter({})
      }
      return tools
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
      const exhaustive: never = selected.provider
      throw new Error(`unhandled provider: ${String(exhaustive)}`)
    }
  }
}
