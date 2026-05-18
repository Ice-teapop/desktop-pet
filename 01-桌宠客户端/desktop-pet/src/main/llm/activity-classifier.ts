/**
 * App → ActivityState 分类器（M3-3-H 三方会谈优化版 + M7-3 切 AI SDK）。
 *
 * 双层策略：
 *  1. **fast-path**（用户可关）：bundleID 白名单 regex 匹配常见 app（IDE / Terminal /
 *     Slack 等 ~30 个），1ms 命中。这是用户决定的 trade-off：默认开避免每次切常用 app
 *     等 LLM 250-500ms，可在托盘菜单关掉走"严格 LLM 识别"。
 *  2. **LLM fallback**：fast-path miss 的陌生 app 交给 Anthropic Haiku 4.5 分类，
 *     bundleID 作 cache key（跨系统语言稳定）+ Promise-based in-flight dedup
 *     （防并发同 app 双 call）。
 *
 * M7-3 设计决定：classifier hardcode Anthropic Haiku 4.5 —— **不跟 user 选的
 * selectedProvider 走**。原因：
 *   - Haiku 4.5 是 cost/speed/正确率 最优解（$1/$5 per 1M tokens + 250ms latency）
 *   - 切到 OpenAI/Gemini 等做活动分类 cost 不一定低 + latency 差异大
 *   - user 没装 Anthropic key 时 classifier disabled，main 走 fast-path-only
 *
 * LLM 调用优化：
 *  - prompt 瘦身：system 写规则，user 只传 "name (bundleId)"，输入 token ~35
 *  - temperature: 0 + maxOutputTokens: 4 让 Haiku 直出类别词，省 ~150ms sampling
 *  - 启动 warmup：app ready 后 dummy classify "Finder" 暖 TLS pool，首次真实 call
 *    从 ~1000ms 降到 ~250ms
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { isValidActivityState, type ActivityState } from '../../shared/chat-types'

export interface AppIdentity {
  bundleId: string
  name: string
}

// in-flight Promise cache —— 同 bundleId 并发请求只走一次 LLM call
const CACHE = new Map<string, Promise<ActivityState>>()

const SYSTEM_PROMPT =
  'Classify macOS app to ONE word: coding | writing | chatting | terminal | idle. ' +
  'coding=IDE/editor. writing=docs/notes. chatting=IM/mail/video. terminal=shell. idle=other.'

const CATEGORIES: readonly ActivityState[] = ['coding', 'writing', 'chatting', 'terminal', 'idle']

/** Anthropic 模型 ID —— hardcoded Haiku 4.5。详见文件头注释为何不跟 selectedProvider 走。 */
const CLASSIFIER_MODEL = 'claude-haiku-4-5'

/**
 * fast-path bundleID 白名单 —— 三方共识"hardcoded 是 LLM 前的预过滤而非替代"。
 * 顺序敏感，第一个匹配赢。常见 ~30 个 app 走 1ms 命中。
 *
 * 用 bundleID 而非 localizedName：跨系统语言 / 不同 channel（Code / Code-Insiders）稳定。
 */
const FAST_PATH: ReadonlyArray<[RegExp, ActivityState]> = [
  // 写代码：IDE / editor / 主流写代码工具
  [
    /^(com\.microsoft\.VSCode(Insiders)?|com\.todesktop\.230313mzl4w4u92|com\.jetbrains\.|com\.googlecode\.iterm2\.shellscript|com\.apple\.dt\.Xcode|com\.sublimetext\.|com\.panic\.Nova|dev\.zed\.|com\.github\.atom|org\.vim\.|org\.gnu\.Emacs|com\.macromates\.TextMate|com\.coteditor\.CotEditor|md\.tomesoftware\.fleet|app\.warp\.|io\.cursor\.|com\.cursor\.)/i,
    'coding'
  ],
  // 终端
  [
    /^(com\.apple\.Terminal|com\.googlecode\.iterm2|dev\.warp\.Warp-Stable|io\.alacritty|net\.kovidgoyal\.kitty|com\.github\.wez\.wezterm|co\.zeit\.hyper|com\.eugeny\.tabby)/i,
    'terminal'
  ],
  // 沟通 / 聊天 / 邮件 / 视频会议
  [
    /^(com\.tinyspeck\.slackmacgap|com\.hnc\.Discord|com\.tencent\.xinWeChat|com\.tencent\.qq|com\.tencent\.WeWorkMac|com\.bytedance\.lark|com\.alibaba\.DingTalkMac|ru\.keepcoder\.Telegram|org\.telegram\.|com\.apple\.MobileSMS|com\.apple\.mail|com\.microsoft\.Outlook|us\.zoom\.xos|com\.microsoft\.teams2?|com\.apple\.FaceTime|com\.skype\.)/i,
    'chatting'
  ],
  // 写文档 / 笔记
  [
    /^(com\.apple\.iWork\.Pages|com\.microsoft\.Word|notion\.id|md\.obsidian|net\.shinyfrog\.bear|abnerworks\.Typora|com\.ulysses\.|com\.craft\.|com\.logseq\.|com\.scrivener\.|com\.roamresearch\.)/i,
    'writing'
  ]
]

/** 用 bundleID 试 fast-path —— 命中返 ActivityState，未命中返 null（让上层 fallback LLM）。 */
export function tryFastPath(app: AppIdentity): ActivityState | null {
  if (!app.bundleId) return null
  for (const [re, state] of FAST_PATH) {
    if (re.test(app.bundleId)) return state
  }
  return null
}

/**
 * 主分类入口 —— cache 命中 < 1ms，未命中走 LLM ~250ms（warmup 后）。
 *
 * 调用方：传 Anthropic API key（不接 selectedProvider 的 key —— classifier
 * 永远跑 Anthropic Haiku，详见文件头 M7-3 注释）。
 */
export async function classifyApp(
  app: AppIdentity,
  anthropicApiKey: string
): Promise<ActivityState> {
  const key = app.bundleId || app.name
  if (!key) return 'idle'
  const cached = CACHE.get(key)
  if (cached) return cached
  // 把 Promise 立刻塞 cache —— 并发请求等同一个 promise，不重复 LLM call
  const promise = doClassify(app, anthropicApiKey)
  CACHE.set(key, promise)
  // 失败时从 cache 移除让下次重试（成功的结果保留）
  promise.catch(() => CACHE.delete(key))
  return promise
}

/**
 * Classifier 网络 timeout：5s。
 *
 * 取代老 Anthropic SDK 的 10min 默认 timeout。AI SDK v6 generateText 默认无
 * timeout —— 不显式设的话，网络 hang 时 Promise 永久 pending；同 bundleId 后
 * 续 await 都拿同一个 dead Promise，user 切到该 app 后永远 stuck "thinking"
 * 不 fallback idle。5s 是经验值：warmup 后冷启 ~250ms，网络抖动留余量。
 *
 * 超时后 generateText throw → doClassify catch 块吞错 + return 'idle' → 该
 * bundleId 这个 session 之后都 cached 'idle'（fail-soft，跟旧设计一致："成
 * 功的结果保留"包括 fail-to-idle）。**不会** 触发 promise.catch CACHE.delete
 * —— catch 内 return 让 promise resolve，promise.catch handler 是 dead code，
 * 仅当 doClassify 自己 throw 才触发（当前没 throw 路径）。
 */
const CLASSIFIER_TIMEOUT_MS = 5000

async function doClassify(
  app: AppIdentity,
  anthropicApiKey: string
): Promise<ActivityState> {
  try {
    const anthropic = createAnthropic({ apiKey: anthropicApiKey })
    const model = anthropic.languageModel(CLASSIFIER_MODEL)
    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: `${app.name} (${app.bundleId})`,
      maxOutputTokens: 4,
      temperature: 0,
      // v0.4.0 fix: 老代码 `timeout: 5000` 是 number 但 AI SDK v6 期望 TimeoutConfiguration
      // object → 静默 ignore, classifier 实际无 timeout 撞 server 慢响应卡几十秒.
      // 改 abortSignal 标准 API, 5s 后 throw AbortError → 上层 catch 'idle' 兜底.
      // maxRetries: 0 — classifier 撞 529 没必要重试 (反正 fail 也是 'idle'), 减 server 同
      // key RPM 窗口压力, 让 chat:submit 拿主路.
      abortSignal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
      maxRetries: 0
    })
    // Haiku 偶发回 "coding." 或 "category: coding"，用 startsWith 兜底
    const trimmed = text.trim().toLowerCase()
    const matched = CATEGORIES.find((c) => trimmed === c || trimmed.startsWith(c))
    return isValidActivityState(matched) ? matched : 'idle'
  } catch (err) {
    console.warn('[classifier] LLM failed for', app.bundleId || app.name, ':', err)
    return 'idle'
  }
}

/**
 * 启动暖 TLS pool —— app ready 后调一次 dummy classify，让 Anthropic HTTPS connection
 * 跟 keep-alive cache 预热。让首次真实切换不吃 TLS 握手 600-1200ms 冷启代价。
 */
export async function warmupClassifier(anthropicApiKey: string): Promise<void> {
  try {
    await doClassify({ bundleId: 'com.apple.finder', name: 'Finder' }, anthropicApiKey)
  } catch {
    // ignore —— 失败不影响 app 启动
  }
}

export function clearClassifyCache(): void {
  CACHE.clear()
}
