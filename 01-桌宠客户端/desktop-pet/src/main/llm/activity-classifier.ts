/**
 * App → ActivityState 分类器（M3-3-H 三方会谈优化版）。
 *
 * 双层策略：
 *  1. **fast-path**（用户可关）：bundleID 白名单 regex 匹配常见 app（IDE / Terminal /
 *     Slack 等 ~30 个），1ms 命中。这是用户决定的 trade-off：默认开避免每次切常用 app
 *     等 LLM 250-500ms，可在托盘菜单关掉走"严格 LLM 识别"。
 *  2. **LLM fallback**：fast-path miss 的陌生 app 交给 Haiku 分类，bundleID 作 cache
 *     key（跨系统语言稳定）+ Promise-based in-flight dedup（防并发同 app 双 call）。
 *
 * LLM 调用优化：
 *  - prompt 瘦身：system 写规则，user 只传 "name (bundleId)"，输入 token ~35 vs 之前 ~135
 *  - temperature: 0 + max_tokens: 4 让 Haiku 直出类别词，省 ~150ms sampling
 *  - 启动 warmup：app ready 后 dummy classify "Finder" 暖 TLS pool，首次真实 call
 *    从 ~1000ms 降到 ~250ms
 */
import Anthropic from '@anthropic-ai/sdk'
import { isValidActivityState, type ActivityState, type ModelId } from '../../shared/chat-types'

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

/** 主分类入口 —— cache 命中 < 1ms，未命中走 LLM ~250ms（warmup 后）。 */
export async function classifyApp(
  app: AppIdentity,
  apiKey: string,
  model: ModelId
): Promise<ActivityState> {
  const key = app.bundleId || app.name
  if (!key) return 'idle'
  const cached = CACHE.get(key)
  if (cached) return cached
  // 把 Promise 立刻塞 cache —— 并发请求等同一个 promise，不重复 LLM call
  const promise = doClassify(app, apiKey, model)
  CACHE.set(key, promise)
  // 失败时从 cache 移除让下次重试（成功的结果保留）
  promise.catch(() => CACHE.delete(key))
  return promise
}

async function doClassify(
  app: AppIdentity,
  apiKey: string,
  model: ModelId
): Promise<ActivityState> {
  try {
    const client = new Anthropic({ apiKey })
    const resp = await client.messages.create({
      model,
      max_tokens: 4,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${app.name} (${app.bundleId})`
        }
      ]
    })
    const block = resp.content[0]
    const text = block?.type === 'text' ? block.text.trim().toLowerCase() : ''
    // Haiku 偶发回 "coding." 或 "category: coding"，用 startsWith 兜底
    const matched = CATEGORIES.find((c) => text === c || text.startsWith(c))
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
export async function warmupClassifier(apiKey: string, model: ModelId): Promise<void> {
  try {
    await doClassify({ bundleId: 'com.apple.finder', name: 'Finder' }, apiKey, model)
  } catch {
    // ignore —— 失败不影响 app 启动
  }
}

export function clearClassifyCache(): void {
  CACHE.clear()
}
