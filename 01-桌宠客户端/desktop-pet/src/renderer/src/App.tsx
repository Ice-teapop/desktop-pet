/**
 * App — M3-3-E（GIF 真动画 + 活动识别 + idle 随机调度 + cr 健壮性补丁）。
 *
 * 渲染层职责：
 *  - 订阅 main 三类状态推送：pet:state (LLM 流) / pet:activity (前台 App) / key:state
 *  - GIF 选择优先级：state(LLM 流) > activity(前台 App) > idle 池（6 个变体随机切）
 *  - 闲态 8–15s 随机切 GIF 不重复 current，硬切由 fade-in/out 过渡掩盖（仅 idle/activity
 *    层级；LLM 流状态切换 bypass fade 立即 swap 避免响应延迟感）
 *  - keyState='missing' 时输入框分流 key 提交 + 错误 hint 去重防累积
 *  - 流式消息 sticky-bottom-scrollback：用户主动滚上去看历史时不被 chunk 拉回底
 *
 * cr 健壮性补丁：
 *  - setState updater 内不放 IPC 副作用（React 18 StrictMode dev 会 double-invoke）
 *  - fade 透明度跟 LLM 流响应感解耦（thinking/success/error bypass fade）
 *  - NOT_KEY_HINT 末尾去重避免连续错误输入刷屏
 *  - hits-rect 检测严格用 chatPhase==='open'（不含 fade-out 中的 'closing'）
 *  - FADE_HALF_MS 单一来源 inline transition style（不跟 main.css 那行重复维护）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetState } from '../../shared/pet-state'
import { ACTIVITY_INFO } from '../../shared/chat-types'
import type { ActivityState, ChatError, KeyState } from '../../shared/chat-types'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/approval-types'
import type { PetMode } from '../../shared/pet-mode'
import { DEFAULT_PET_MODE } from '../../shared/pet-mode'
import { detectProvider } from '../../shared/key-detect'
import { PROVIDERS, PROVIDER_ORDER } from '../../shared/provider-types'
import type { SelectedModel } from '../../shared/provider-types'
import { getToolDisplay } from '../../shared/tool-display'
import { t } from '../../shared/i18n'
// idle 池 6 种"无聊时的小动作"，闲态随机切
import idleGif from '@themes/clawd-dev/clawd-idle.gif'
import idleReadingGif from '@themes/clawd-dev/clawd-idle-reading.gif'
import sweepingGif from '@themes/clawd-dev/clawd-sweeping.gif'
import jugglingGif from '@themes/clawd-dev/clawd-juggling.gif'
import buildingGif from '@themes/clawd-dev/clawd-building.gif'
import conductingGif from '@themes/clawd-dev/clawd-conducting.gif'
import sleepingGif from '@themes/clawd-dev/clawd-sleeping.gif'
// v0.4.3+ set_pet_animation 新加 2 type
import carryingGif from '@themes/clawd-dev/clawd-carrying.gif'
import ultrathinkSvg from '@themes/clawd-dev/clawd-working-ultrathink.svg'
// M9-2 click reactions
import reactDoubleJumpGif from '@themes/clawd-dev/clawd-react-double-jump.gif'
import reactAnnoyedGif from '@themes/clawd-dev/clawd-react-annoyed.gif'
// M9-3 sleep sequence 多阶段（SMIL-animated SVG，<img src> 自动播）
import yawningSvg from '@themes/clawd-dev/clawd-idle-yawn.svg'
import dozingSvg from '@themes/clawd-dev/clawd-idle-doze.svg'
import collapsingSvg from '@themes/clawd-dev/clawd-idle-collapse.svg'
import wakingSvg from '@themes/clawd-dev/clawd-wake.svg'
// M9-4 eye tracking: inline SVG component（?react suffix triggers vite-plugin-svgr）
import IdleFollowSvg from '@themes/clawd-dev/clawd-idle-follow.svg?react'
// M9-5a mini mode (sub-wave A 只用 idle；后续 hover/alert 在 sub-wave B 加)
import miniIdleGif from '@themes/clawd-dev/clawd-mini-idle.gif'
// v0.4.3+: 进 mini 时短暂播一次 enter.gif 当过渡 (~1.6s), 之后 settle 到 mini-idle
import miniEnterGif from '@themes/clawd-dev/clawd-mini-enter.gif'
// v0.4.5+ Batch 1: hover-peek 替换静态 SVG + success/error 在 mini 模式下的反应
import miniPeekGif from '@themes/clawd-dev/clawd-mini-peek.gif'
import miniHappyGif from '@themes/clawd-dev/clawd-mini-happy.gif'
import miniAlertGif from '@themes/clawd-dev/clawd-mini-alert.gif'
// v0.4.5+ Batch 2: 检查更新发现新版时桌宠头顶弹动画通知 (full mode);
// mini mode 复用 mini-alert.gif (80×80 装不下 96×96 notification.gif)
import notificationGif from '@themes/clawd-dev/clawd-notification.gif'
// activity → GIF 映射：识别到不同活动时桌宠"陪你做同样的事"
import typingGif from '@themes/clawd-dev/clawd-typing.gif'
import debuggerGif from '@themes/clawd-dev/clawd-debugger.gif'
import headphonesGif from '@themes/clawd-dev/clawd-headphones-groove.gif'
// LLM 流状态
import thinkingGif from '@themes/clawd-dev/clawd-thinking.gif'
import happyGif from '@themes/clawd-dev/clawd-happy.gif'
import errorGif from '@themes/clawd-dev/clawd-error.gif'

const DRAG_THRESHOLD_PX = 5

// M9-4 eye tracking 参数（SVG 单位 = viewBox 1 单位 ≈ ~7px 显示尺寸）：
//   SENSE_RANGE_PX = cursor 超过这个距离 pet 中心 → eye/body 进入饱和（最大偏移）
//   EYE_MAX_SVG = eye group transform 最大偏移（svg units）
//   BODY_MAX_DEG = 身体倾斜最大角度
//   SHADOW_MAX_STRETCH = 影子 scaleX 增量（1 = 不变；1 + 0.2 = 拉长 20%）
const SENSE_RANGE_PX = 600
const EYE_MAX_SVG = 0.4
const BODY_MAX_DEG = 4
const SHADOW_MAX_STRETCH = 0.2

// M9-2 click burst 时间常量：
//   POKE_DETECT_MS = 单击 burst window；250ms 内没新 click → fire burst action
//     trade-off：单击 toggle chat 现在延迟 250ms（必须等是否第 2 击决定意图）
//   STARTLED_BURST_MS = 4 连击窗口；within 1.5s 累 4 击立即 startled
const POKE_DETECT_MS = 250
const STARTLED_BURST_MS = 1500

// idle 节奏：15–30s 比之前 8–15s 慢一倍 —— 桌宠是周边视野，频繁切=多动症，缓节奏 = 陪伴感
const IDLE_VARIANT_MIN_MS = 15000
const IDLE_VARIANT_MAX_MS = 30000
// idle-reading GIF 是一次性表演的姿态（坐姿看书一个 loop ~ 5-7s），不该跟其他 idle 一样
// 占 15-30s。检测到 reading 时短化 delay 让它播完一遍就切走
const READING_LOOP_MS = 7000
// Cross-fade 单边时长：双层 img overlap 跑同一时长，所以总切换感官 ≈ FADE_HALF_MS
// 280ms 落在人眼 motion-fusion 阈值（~250ms），ease-in-out 让首尾更柔
const FADE_HALF_MS = 280
const FADE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/**
 * idle 池 —— 6 个变体完全随机切，唯一规则是不重复当前正在播的那个。
 * 不强制"动作 → 静态"流程，让节奏不可预测；扫地→杂耍这种姿态硬跳由
 * fade-out / fade-in 的透明度过渡掩盖（FADE_HALF_MS × 2 = 320ms）。
 */
const IDLE_POOL: ReadonlyArray<string> = [
  idleGif,
  idleReadingGif,
  sweepingGif,
  jugglingGif,
  buildingGif,
  conductingGif
]

function pickNextIdle(currentIdx: number): number {
  // 池只剩 0/1 个时无可切，保持当前不动（防御性：future 改主题包后崩）
  if (IDLE_POOL.length <= 1) return currentIdx
  // 从 [0, n-1] 排除 currentIdx 后随机选 —— 取 [0, n-2] 然后遇 currentIdx 顺移
  let next = Math.floor(Math.random() * (IDLE_POOL.length - 1))
  if (next >= currentIdx) next++
  return next
}

// LLM 流相关 GIF —— 用于 fade 路径区分（这些状态切换 bypass fade 立即生效）
const LLM_FLOW_GIFS = new Set<string>([thinkingGif, happyGif, errorGif])

// activity → GIF：识别到不同活动时桌宠"陪你做同样的事"
const ACTIVITY_GIF: Readonly<Record<Exclude<ActivityState, 'idle'>, string>> = {
  coding: typingGif, // 写代码 → 敲键盘
  writing: typingGif, // 写文档 → 同上（都是码字）
  chatting: headphonesGif, // 沟通 → 戴耳机摇头
  terminal: debuggerGif // 终端 → debugger 形象
}

const GREETING_TEXT =
  '嗨，第一次见面 🦀 我是 Claw。要跟我聊天得先有把 API key —— 任意 provider 都行 (Anthropic / OpenAI / Google / xAI / DeepSeek / 字节豆包)，把 key 粘到下面发给我，我会自动识别 + 本地加密保存。'

// 中性文案 —— 不暗示「已加密存好」，因为 Linux 无 keyring 时存盘会失败但内存仍可用，
// 后续 'key-not-persisted' 错误气泡会单独说明「下次启动会丢」，两条不互相打脸
const KEY_STORED_TEXT = '钥匙记下了，咱们可以聊了 🦀'

const KEY_RESET_PROMPT = '🔑 钥匙没了或被拒了 —— 再贴一个 API key 给我？'

const NOT_KEY_HINT =
  '🤔 这看着不像 API key (我认 Anthropic sk-ant- / OpenAI sk- 或 sk-proj- / Google AIza / xAI xai- / 字节豆包 UUID)。复制时检查下别带空格。'

/**
 * Renderer-only ChatMessage —— main-side `shared/chat-types.ChatMessage` (user|assistant)
 * 是发给 Anthropic API 的严格形态，本接口扩展给 UI 渲染用：
 *   - 'user' / 'ai': 主对话气泡 (现有)
 *   - 'system': v0.4.0 系统提示 (e.g., 季节装扮 hint / NOT_KEY_HINT) —— msg-system 灰 muted 气泡
 *   - 'tool': v0.4.0 [A] AI 调 tool 时 inline 状态卡 —— msg-tool 加图标 + 状态点
 * tool/file 字段为各自卡片携带的附加渲染数据 (S2/S5 实现时填充).
 */
interface ChatMessage {
  id: number
  role: 'user' | 'ai' | 'system' | 'tool'
  text: string
  status: 'streaming' | 'done' | 'error'
  // [A] msg-tool 卡: tool 调用名 + 状态 (running / done / error) + toolCallId 匹配 start/end
  tool?: { name: string; status: 'running' | 'done' | 'error'; toolCallId: string }
  // [D] msg-file 卡: 文件信息 + 处理结果摘要
  file?: { name: string; ext: string; summary?: string }
}

function chatErrorText(err: ChatError): string {
  switch (err.kind) {
    case 'no-api-key':
      return t('err.no_api_key')
    case 'invalid-api-key':
      return t('err.invalid_api_key')
    case 'rate-limited':
      return err.retryAfterSec
        ? t('err.rate_limited_with_sec', String(err.retryAfterSec))
        : t('err.rate_limited')
    case 'overloaded':
      return t('err.overloaded')
    case 'network':
      return t('err.network')
    case 'key-not-persisted':
      return t('err.key_not_persisted')
    case 'key-format-invalid':
      return t('err.key_format_invalid')
    case 'empty-response':
      return [
        t('err.empty_response_intro', err.finishReason),
        t('err.empty_response_reason_1'),
        t('err.empty_response_reason_2'),
        t('err.empty_response_reason_3')
      ].join('\n')
    case 'api':
      return t('err.api', err.message)
    default:
      return t('err.unknown', err.message)
  }
}

type ChatPhase = 'closed' | 'opening' | 'open' | 'closing'


function App(): React.JSX.Element {
  const [state, setState] = useState<PetState>('idle')
  const [chatPhase, setChatPhase] = useState<ChatPhase>('closed')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  // null = 主进程还没推第一条；之后就是 'missing' | 'ready'
  const [keyState, setKeyState] = useState<KeyState | null>(null)
  // 活动识别状态：默认 idle，主进程 detector 通过 pet:activity 推
  const [activity, setActivity] = useState<ActivityState>('idle')
  // v0.4.0 S4.3 [A] pet-toast: tool 'end' 时头顶弹 2.7s "✓ <toolName>" 字条
  const [petToast, setPetToast] = useState<{ id: number; text: string } | null>(null)
  const petToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v0.4.0 S4.4 [B] pet-emote-hint: activity 切换时头顶弹 4s 表情气泡
  const [emoteHint, setEmoteHint] = useState<string | null>(null)
  const emoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<ActivityState>('idle')
  // v0.4.0 S3.3 [B] companion mode (跟着我做事). 用户反馈"默认开启", 改 default true.
  // 已从 chat 顶部 pill 改成静默开启 — 真要关时去 Settings (pending S3.3-impl).
  const [petCompanionEnabled] = useState(true)
  // v0.4.0 改动 4: chat 顶部模型切换 pill 需要的当前选中模型 state
  const [currentModel, setCurrentModel] = useState<SelectedModel | null>(null)
  // v0.4.0 改动 4: 动态 listModels — per-provider 列表, modal open 状态
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  // v0.4.0 S6.2 [D] DnD overlay: 用户拖文件到 pet 上方时显示 .pet-drop 大字
  // S6.3-S6.5 (主进程读文件 + agentic 处理) 后续拆出, 现在仅 renderer overlay
  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0) // dragenter/leave 配对计数 (子元素冒泡防抖)
  // M9-5a: 顶层 petMode（full 完整 240×240 vs mini 80×80 藏边）
  const [petMode, setPetMode] = useState<PetMode>(DEFAULT_PET_MODE)
  // v0.4.3+: 进 mini 时短暂播 enter.gif 当过渡, ~1.6s 后 settle 到 mini-idle
  const [miniEntering, setMiniEntering] = useState(false)
  // v0.4.5+ Batch 1: main 主进程 hover-peek 边沿 → onMiniPeek push true/false,
  // renderer 切 mini-peek.gif (有 user 靠近) / mini-idle.gif (回归默认).
  const [miniPeeking, setMiniPeeking] = useState(false)
  // v0.4.5+ Batch 2: update:available 真有新版本时桌宠头顶弹通知 GIF ~3.6s.
  // notifyPop.id 触发 key 重挂让 GIF 从 frame 0 重启 (多次点"检查更新"也能重 restart).
  const [notifyPop, setNotifyPop] = useState<{ id: number; url: string } | null>(null)
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // idle 6 变体池索引（仅 stateMachine=idle + activity=idle 时玩）
  const [idleVariantIdx, setIdleVariantIdx] = useState(0)
  // 双层 <img> cross-fade：两个 absolute 叠加，frontIdx 指当前显示的那层
  // 切换时把新 url 塞 back 层（opacity 0），等 onLoad（新 GIF 解码完）→ swap frontIdx
  // → CSS opacity transition 让 back 0→1 + front 1→0 同时 ramp，永远不出现透明窗口
  const [frontIdx, setFrontIdx] = useState<0 | 1>(0)
  const [urls, setUrls] = useState<[string, string]>([IDLE_POOL[0], IDLE_POOL[0]])
  // —— M4-C 高风险 tool 待审批的请求队列 ——
  // 队列化（v0.4 后续 fix）: 原来是单 state 'last-wins' 覆盖, 多个并发 IPC 来
  // 只显示最后一个, 其它 N-1 个在 main 端 60s timeout 后被 auto-deny → 用户
  // 看到「批量删除失败 N-1 次」的假象。改成 queue 后, head 显示, response 后 shift。
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([])
  const pendingApproval = approvalQueue[0] ?? null
  // v0.4.0 改动 1: vision/tavily UI 全部迁移到 Settings, 这里不再持 state.
  // 记录"想切到的 url" —— 防止 back img 在我们没期待时（如初始 mount）fire onLoad 误触发 swap
  const pendingBackRef = useRef<string | null>(null)
  const msgIdRef = useRef(1)
  const prevKeyStateRef = useRef<KeyState | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const convRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  // chatPhase 当前值的 ref —— window 'mouseup' native listener 闭包内拿最新 phase 用，
  // 替代 functional setChatPhase((p) => ...)（实测在某些路径 updater 看似 invoke 但
  // closure 内的 needOpenChat 赋值不可靠 —— React 18+ native event batching 路径）
  const chatPhaseRef = useRef<ChatPhase>('closed')
  const dragRef = useRef<{
    /** M9-1: Pointer Events 的 pointerId —— setPointerCapture 后所有 event 都
     * forward 到 capture target 不管 cursor 在屏幕哪。move/up 时校验 pointerId
     * 匹配防多指 / 重入。 */
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)

  /**
   * M9-2 click reactions: 累计 burst click 数决定单击 / 双击 / 4 连击 action。
   * - 单击 (count=1 + 250ms idle) → toggle chat
   * - 2-3 连击 → poke 反应 (react-double-jump)
   * - 4+ 连击 (within 1.5s) → 立即 startled 反应 (react-annoyed)
   * 250ms delay 单击 toggle chat 是 trade-off：必须等是否有第 2 击决定意图。
   */
  const clickRef = useRef<{
    count: number
    firstAt: number
    timer: ReturnType<typeof setTimeout> | null
  } | null>(null)

  /**
   * M9-4 eye tracking: main 端 30Hz 推 cursor dx/dy 进 ref（**不**触发 React
   * re-render）。rAF loop 读 ref → 直接 mutate IdleFollow SVG 内部 group 的
   * style.transform（CSS 已 transition: transform 0.2s ease-out 让 30Hz 输入
   * 平滑过渡，不需手动 lerp）。
   */
  const cursorRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const idleFollowSvgRef = useRef<SVGSVGElement>(null)

  const isConvMounted = chatPhase === 'open' || chatPhase === 'closing'
  // 等 AI 回复：ready 状态下最后一条是 user 才显示 typing
  // missing 下 user 提交 key/普通文本后渲染层会立即插入 AI 回应，不会卡 typing
  const isWaitingForReply =
    keyState === 'ready' && messages.length > 0 && messages[messages.length - 1].role === 'user'

  useEffect(() => {
    const off = window.api.onPetState((s) => setState(s))
    return off
  }, [])

  // 同步 chatPhase 到 ref —— 让 native event listener / IPC handler 闭包拿最新 phase
  useEffect(() => {
    chatPhaseRef.current = chatPhase
  }, [chatPhase])

  useEffect(() => {
    const off = window.api.onActivityState((a) => setActivity(a))
    return off
  }, [])

  // v0.4.0 改动 4: 订阅 selectedModel + 启动时拉一次, 给 chat 顶部模型 pill 用
  useEffect(() => {
    const off = window.api.onSelectedModelState((sel) => setCurrentModel(sel))
    window.api.requestSelectedModelState()
    return off
  }, [])

  // v0.4.0 改动 4: 订阅 dynamic listModels — main 先 push cache, 再异步 refresh
  useEffect(() => {
    const off = window.api.onAvailableModels((r) => setModelsByProvider(r))
    window.api.requestAvailableModels()
    return off
  }, [])

  // v0.4.0 改动 4 modal: 改 modal 后 overlay backdrop onClick 已处理关闭, 不需 outside-click effect.

  // v0.4.0 S4.4 [B] emote-hint: activity 切换时头顶弹 4s 表情气泡.
  // gate by petCompanionEnabled — 默认关闭, 用户开启 🎭 pill 后才弹.
  // 不依赖 'idle' (空闲态不打扰), 仅在转入 coding/writing/chatting/terminal 时显示.
  useEffect(() => {
    const prev = lastActivityRef.current
    lastActivityRef.current = activity
    if (!petCompanionEnabled) return
    if (activity === 'idle' || activity === prev) return
    const info = ACTIVITY_INFO[activity]
    if (emoteTimerRef.current) clearTimeout(emoteTimerRef.current)
    setEmoteHint(`${info.emoji} 你${info.label}, 我陪你`)
    emoteTimerRef.current = setTimeout(() => setEmoteHint(null), 4000)
  }, [activity, petCompanionEnabled])

  // M9-5a: 订阅 petMode + 启动 race 防御 (pull request-state)
  // 进 mini 时主进程已 stopCursorPoll → 进 full 前 cursorRef 是 stale；这里 reset
  // 到 (0,0)，避免切回 full 第一帧用过期 dx/dy 把 eyes/body/shadow 转到错的方向
  // （CSS transition 会平滑追上，但视觉上会"先看错再回来"）。
  useEffect(() => {
    const off = window.api.onPetMode((m) => {
      cursorRef.current = { dx: 0, dy: 0 }
      setPetMode(m)
    })
    window.api.requestPetModeState()
    return off
  }, [])

  // v0.4.3+: 进 mini 时短暂播 clawd-mini-enter.gif 当过渡 (~1.6s ≈ 一个 GIF cycle),
  // 之后 settle 到 mini-idle. 防止 full → mini 硬切感. 出 mini 不需要过渡 (full
  // 是默认渲染层, 直接显示).
  useEffect(() => {
    if (petMode !== 'mini') {
      setMiniEntering(false)
      return
    }
    setMiniEntering(true)
    const tid = setTimeout(() => setMiniEntering(false), 1600)
    return () => clearTimeout(tid)
  }, [petMode])

  // v0.4.5+ Batch 1: 订阅 main 的 mini-peek 边沿 push, 切 GIF 让桌宠探头看 user.
  useEffect(() => {
    const off = window.api.onMiniPeek((peeking) => setMiniPeeking(peeking))
    return off
  }, [])

  // M9-5b B-3: 进 mini 时 main 强制关 chat —— 直接 setChatPhase('closed') 跳过 closing
  // 动画（窗口已 100×100，'conv-fade-out' animation 看不见）。chatPhaseRef 由上面 effect
  // 同步。messages 保留不清 —— 用户回 full 后历史还在。
  useEffect(() => {
    const off = window.api.onChatForceClose(() => {
      setChatPhase('closed')
    })
    return off
  }, [])

  // v0.4.3+ DnD belt-and-suspenders: 原生 window-level 监听做 fallback.
  // React synthetic event 在透明 BrowserWindow + macOS 偶尔丢 dragenter/over/drop;
  // 原生 addEventListener 直接挂 window 不依赖 React event delegation, 兜住 React 漏的.
  // 跟 .stage 上的 React handler 双轨, 哪个先 fire 哪个驱动 setDragOver / dropFiles.
  useEffect(() => {
    const onEnter = (e: DragEvent): void => {
      e.preventDefault()
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
      console.log('[dnd] dragenter (native)', { types })
      if (types.includes('Files')) setDragOver(true)
    }
    const onOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent): void => {
      // 只有 leave 出 window 才清 (子元素间穿梭不算)
      if (e.relatedTarget === null) {
        console.log('[dnd] dragleave (native, exit window)')
        setDragOver(false)
        dragDepthRef.current = 0
      }
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
      console.log('[dnd] drop (native)', {
        fileCount: files.length,
        types: e.dataTransfer ? Array.from(e.dataTransfer.types) : []
      })
      setDragOver(false)
      dragDepthRef.current = 0
      const paths = files
        .map((f) => window.api.getPathForFile(f))
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      console.log('[dnd] drop paths (native)', paths)
      if (paths.length === 0) return
      void (async (): Promise<void> => {
        const result = await window.api.dropFiles(paths)
        if (result.accepted.length === 0 && result.rejected.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: msgIdRef.current++,
              role: 'system' as const,
              text:
                `⚠️ 拖入的 ${result.rejected.length} 个文件全部被拒:\n` +
                result.rejected.map((r) => `• ${r.path} — ${r.reason}`).join('\n'),
              status: 'done' as const
            }
          ])
          return
        }
        setMessages((prev) => [
          ...prev,
          {
            id: msgIdRef.current++,
            role: 'user' as const,
            text: result.summary,
            status: 'done' as const
          }
        ])
        window.api.submitChat(result.summary)
      })()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // v0.4.3+ Tray drop-files fallback: 透明 NSPanel 不接 HTML5 drop, 改走 macOS
  // 原生 Tray drop event. main 在 tray.on('drop-files') 拿到路径直接送过来 — 跳
  // 过 renderer drag pipeline, 直接走 chat:drop-files IPC + 跟 .stage onDrop 同
  // 一份后续 (push user msg + submitChat).
  useEffect(() => {
    const off = window.api.onTrayDropFiles((paths) => {
      console.log('[dnd] tray drop-files received', paths.length, 'file(s)')
      if (paths.length === 0) return
      void (async (): Promise<void> => {
        const result = await window.api.dropFiles(paths)
        if (result.accepted.length === 0 && result.rejected.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: msgIdRef.current++,
              role: 'system' as const,
              text:
                `⚠️ 拖入的 ${result.rejected.length} 个文件全部被拒:\n` +
                result.rejected.map((r) => `• ${r.path} — ${r.reason}`).join('\n'),
              status: 'done' as const
            }
          ])
          return
        }
        setMessages((prev) => [
          ...prev,
          {
            id: msgIdRef.current++,
            role: 'user' as const,
            text: result.summary,
            status: 'done' as const
          }
        ])
        window.api.submitChat(result.summary)
      })()
    })
    return off
  }, [])

  // v0.4.0 改动 1: tray 点 "屏幕感知" toggle 但用户没 consent → 改成直接打开 Settings,
  // vision consent UI 已迁到 Settings 窗口的「Agentic 工具」section.
  useEffect(() => {
    const off = window.api.onVisionRequestConsentModal(() => {
      window.api.openSettings()
    })
    return off
  }, [])

  // idle 子调度器：state=idle && activity=idle 时按 pickNextIdle 完全随机切（不重复 current）。
  // 姿态硬跳由 fade 透明度过渡掩盖。reading "喝茶动作" 一次性 7s 后切走（GIF 一个 loop 时长）。
  // 加 idleVariantIdx 到依赖：每次切了 variant 重 schedule，让 reading 用短 delay。
  useEffect(() => {
    if (state !== 'idle' || activity !== 'idle') return
    const schedule = (): NodeJS.Timeout => {
      const isReading = IDLE_POOL[idleVariantIdx] === idleReadingGif
      const delay = isReading
        ? READING_LOOP_MS
        : IDLE_VARIANT_MIN_MS + Math.random() * (IDLE_VARIANT_MAX_MS - IDLE_VARIANT_MIN_MS)
      return setTimeout(() => {
        setIdleVariantIdx((cur) => pickNextIdle(cur))
      }, delay)
    }
    const timer = schedule()
    return () => clearTimeout(timer)
  }, [state, activity, idleVariantIdx])

  // mount 后立刻 ping 主进程要当前 keyState —— 防御启动 race：
  // 主进程 did-finish-load 推 key:state 时若这个 useEffect 还没 subscribe 会丢
  useEffect(() => {
    const off = window.api.onKeyState((s) => setKeyState(s))
    // M9-4 eye tracking: 订阅 main 端 30Hz cursor push → 写 ref，不触发 React re-render
    const offCursor = window.api.onPetCursor((cursor) => {
      cursorRef.current = cursor
    })

    window.api.requestKeyState()
    return () => {
      off()
      offCursor()
    }
  }, [])

  /**
   * M9-4 eye tracking rAF loop：每帧从 cursorRef 读取最新 cursor 位置 → mutate
   * IdleFollow SVG 内部 `#eyes-js` / `#body-js` / `#shadow-js` group 的
   * style.transform。**不**触发 React render（直接 DOM mutation）。
   *
   * Officer B fixes:
   *   - querySelector cache：mount 一次性 query 3 group + 存闭包变量，rAF 直接读
   *     （之前每帧 ×3 = 180 q/sec，svgr forwardRef 让 svg mount 后 group 引用稳定）
   *   - SVG opacity 0 (非 idle) 时 skip transform mutation（CSS 已 transition,
   *     残留 transform 值无视觉影响；省 frame 写）
   *
   * CSS 已 transition: transform 0.2s ease-out 让 30Hz 输入平滑，不需手动 lerp.
   */
  useEffect(() => {
    const svg = idleFollowSvgRef.current
    if (!svg) return
    // querySelector 一次性 mount 时拿 3 group 引用，rAF 直接读 closure 变量
    const eyes = svg.querySelector<SVGGElement>('#eyes-js')
    const body = svg.querySelector<SVGGElement>('#body-js')
    const shadow = svg.querySelector<SVGGElement>('#shadow-js')
    let raf = 0
    const tick = (): void => {
      // 非 idle-follow 模式 skip mutation（SVG 不可见，无意义的 style write）
      // 当前 inline check 比把 state 进 deps 触发 rAF 重启更简单
      if (petMode === 'full' && state === 'idle' && activity === 'idle') {
        const { dx, dy } = cursorRef.current
        const normX = Math.max(-1, Math.min(1, dx / SENSE_RANGE_PX))
        const normY = Math.max(-1, Math.min(1, dy / SENSE_RANGE_PX))
        if (eyes) {
          eyes.style.transform = `translate(${normX * EYE_MAX_SVG}px, ${normY * EYE_MAX_SVG}px)`
        }
        if (body) {
          body.style.transform = `rotate(${normX * BODY_MAX_DEG}deg)`
        }
        if (shadow) {
          shadow.style.transform = `scaleX(${1 + Math.abs(normX) * SHADOW_MAX_STRETCH}) translateX(${normX * 0.5}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // state + activity + petMode 进 deps —— gate inline 判断需要拿最新值，重启 rAF 更稳。
    // mini mode 时 SVG opacity=0 不可见 → 不必每帧 write 3 个 invisible style.transform
  }, [state, activity, petMode])

  // v0.4.0 改动 1: vision/tavily state 订阅 已迁移到 Settings 窗口

  // —— 订阅 main 端的 approval 请求 ——
  // 入队尾。 head 由 modal 渲染, response 后 shift 头部, 下一个自动现身。
  // 防 race: 即使 main 端有并发 IPC (batch tool 引入后理论上少了, 但 read_file/
  // write_file 等其它 tool 仍可能 concurrent), 也不会丢请求。
  useEffect(() => {
    const off = window.api.onApprovalRequest((req) =>
      setApprovalQueue((q) => [...q, req])
    )
    return off
  }, [])

  // —— head 变化时通知 main: 此 id modal 真正在显示 → 启 60s auto-deny 计时 ——
  // 防队列里第 N 个 request 在前 N-1 个被处理期间静默 timeout
  const lastDisplayedIdRef = useRef<string | null>(null)
  useEffect(() => {
    const headId = pendingApproval?.id ?? null
    if (headId && headId !== lastDisplayedIdRef.current) {
      lastDisplayedIdRef.current = headId
      window.api.notifyApprovalDisplayed(headId)
    }
    if (!headId) {
      lastDisplayedIdRef.current = null
    }
  }, [pendingApproval?.id])

  // —— 清空对话历史 (reset key / 跨 provider 切 / Settings 手动清) → 同步清 UI 消息 ——
  // PR-2: 加 reason 区分; 仅跨 provider 时 push system 气泡告知用户 (key-reset 已有
  // KEY_RESET_PROMPT 接管, manual 是用户自己点的不必告知). 气泡只入 renderer messages
  // 数组, 不入 main chatHistory (防 LLM 上下文污染).
  useEffect(() => {
    const off = window.api.onChatHistoryCleared((event) => {
      setMessages(() => {
        if (event.reason === 'provider-switch' && event.toProvider) {
          const providerLabel =
            PROVIDERS[event.toProvider as keyof typeof PROVIDERS]?.label ??
            event.toProvider
          return [
            {
              id: msgIdRef.current++,
              role: 'system' as const,
              text: t('chat.history_cleared_provider_switch', providerLabel),
              status: 'done' as const
            }
          ]
        }
        return []
      })
    })
    return off
  }, [])

  // 改动 8 [#7] 更新检查 — main 启动 30s 后自动 + tray 手动, 收到事件 push 系统气泡.
  // 有新版本 → "v0.4.1 可用 · 点这里 ↗" 可点 (用户拷 URL 自己打开); 已是最新 → 灰提示.
  useEffect(() => {
    const off = window.api.onUpdateAvailable((event) => {
      const text = event.upToDate
        ? t('chat.update_up_to_date', event.version)
        : t('chat.update_available', event.version, event.htmlUrl)
      setMessages((prev) => [
        ...prev,
        {
          id: msgIdRef.current++,
          role: 'system' as const,
          text,
          status: 'done' as const
        }
      ])
      // v0.4.5+ Batch 2: 真新版本 (非 upToDate) 才弹通知 GIF — 已是最新不弹
      // (避免训练用户忽略信号). htmlUrl 必须有才能点击跳转.
      if (!event.upToDate && event.htmlUrl) {
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current)
        setNotifyPop({ id: Date.now(), url: event.htmlUrl })
        notifyTimerRef.current = setTimeout(() => setNotifyPop(null), 3600)
      }
    })
    // unsubscribe + 清 timer 合并到一个 cleanup, 防 React StrictMode / HMR 下
    // effect 重跑时 timer 仍在 fire 改 unmount 树的 state
    return () => {
      off()
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current)
    }
  }, [])

  const handleApprovalDecision = (decision: ApprovalDecision): void => {
    if (!pendingApproval) return
    // trust-dir-* 决策需要目录路径 —— 从 req.path 推出（path 是文件或目录绝对路径）
    // 批量场景 (paths.length > 1) 在 modal UI 层就已隐藏 trust-dir-* 按钮,
    // 这里仍兜底: 若 main 端拿到 trust-dir-* 但 dirToTrust 缺失会 noop。
    const dirToTrust = pendingApproval.path
      ? pendingApproval.path.endsWith('/')
        ? pendingApproval.path
        : pendingApproval.path.replace(/\/[^/]*$/, '') || '/'
      : undefined
    window.api.sendApprovalResponse(pendingApproval.id, decision, dirToTrust)
    setApprovalQueue((q) => q.slice(1))
  }

  // keyState 转变（非 'missing' → 'missing'）才插迎宾，避免重复推送 missing 时反复插。
  // 进入 missing 时清空 messages：主进程同步清了 chatHistory，UI 保留旧气泡会让用户
  // 误以为 Claw 还记得上下文。文案动态：首启用完整自我介绍；重设/key 失效用简短重引导。
  useEffect(() => {
    if (!keyState) return
    const prev = prevKeyStateRef.current
    prevKeyStateRef.current = keyState

    if (keyState === 'missing' && prev !== 'missing') {
      const isFirstTime = prev === null
      const text = isFirstTime ? GREETING_TEXT : KEY_RESET_PROMPT
      setMessages((cur) => [...cur, { id: msgIdRef.current++, role: 'ai', text, status: 'done' }])
      // 用 ref 拿 latest phase，避免 functional setter 在 React 18+ native event 路径上
      // closure 副作用赋值不可靠的问题
      if (chatPhaseRef.current === 'closed') {
        setChatPhase('open')
        window.api.setChatOpen(true)
      }
    } else if (keyState === 'ready' && prev === 'missing') {
      setMessages((cur) => [
        ...cur,
        { id: msgIdRef.current++, role: 'ai', text: KEY_STORED_TEXT, status: 'done' }
      ])
    }
  }, [keyState])

  useEffect(() => {
    const off = window.api.onChatChunk((delta) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'ai' && last.status === 'streaming') {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }]
        }
        return [...prev, { id: msgIdRef.current++, role: 'ai', text: delta, status: 'streaming' }]
      })
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.api.onChatDone(() => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'ai' && last.status === 'streaming') {
          return [...prev.slice(0, -1), { ...last, status: 'done' }]
        }
        return prev
      })
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.api.onChatError((err) => {
      // S2 fix #1 (part): error 时清 running tool msg (它们等不到 tool-result 了)
      setMessages((prev) => {
        const swept = prev.map((m) =>
          m.tool && m.tool.status === 'running'
            ? {
                ...m,
                status: 'error' as const,
                tool: { ...m.tool, status: 'error' as const }
              }
            : m
        )
        return [
          ...swept,
          { id: msgIdRef.current++, role: 'ai' as const, text: chatErrorText(err), status: 'error' as const }
        ]
      })
    })
    return off
  }, [])

  // v0.4.0 [A] msg-tool 卡: AI 调 tool 时 main 推 chat:tool-event {kind:'start'|'end'|'error', toolCallId, toolName}.
  // kind='start' → 插新 'tool' role message (status='running'); kind='end' → match toolCallId 改 status='done'.
  // S2 fix #3: 同 toolCallId 多次 'start' 事件 (multi-step retry / fallback chain) 去重,
  //            防止堆多张卡只有第一张被 end 命中其余永远 spinning.
  useEffect(() => {
    const off = window.api.onChatToolEvent((event) => {
      if (event.kind === 'start') {
        setMessages((prev) => {
          // 去重: 已有同 toolCallId 卡就别插
          if (prev.some((m) => m.tool?.toolCallId === event.toolCallId)) {
            return prev
          }
          return [
            ...prev,
            {
              id: msgIdRef.current++,
              role: 'tool' as const,
              text: '',
              status: 'streaming' as const,
              tool: {
                name: event.toolName,
                status: 'running' as const,
                toolCallId: event.toolCallId
              }
            }
          ]
        })
      } else {
        // end / error → find by toolCallId, update status
        const newStatus: 'done' | 'error' = event.kind === 'end' ? 'done' : 'error'
        setMessages((prev) =>
          prev.map((m) =>
            m.tool && m.tool.toolCallId === event.toolCallId
              ? {
                  ...m,
                  status: (newStatus === 'error' ? 'error' : 'done') as 'error' | 'done',
                  tool: { ...m.tool, status: newStatus }
                }
              : m
          )
        )
        // v0.4.0 S4.3 [A] tool 'end' → 头顶 toast (2.7s)
        // tool 'error' 不弹 toast, 已经在 msg-tool 卡显红色状态
        if (event.kind === 'end') {
          if (petToastTimerRef.current) clearTimeout(petToastTimerRef.current)
          const display = getToolDisplay(event.toolName)
          setPetToast({ id: Date.now(), text: `✓ ${display.label}` })
          petToastTimerRef.current = setTimeout(() => setPetToast(null), 2700)
        }
      }
    })
    return off
  }, [])

  // S2 fix #1: abort / 切 turn / error 时清掉所有 still-running 的 msg-tool 卡.
  // tool-call 后 stream abort → tool-result 永远不到 → UI 卡 "运行中 ⠂⠂⠂".
  // 任何 chat 错误 / 新 submit 时把 running tool msg 标 'error' 让用户看到该卡终止了.
  const sweepRunningToolMessages = useCallback((): void => {
    setMessages((prev) =>
      prev.map((m) =>
        m.tool && m.tool.status === 'running'
          ? { ...m, status: 'error' as const, tool: { ...m.tool, status: 'error' as const } }
          : m
      )
    )
  }, [])

  useEffect(() => {
    const off = window.api.onChatWindowReady(() => {
      setChatPhase((p) => (p === 'opening' ? 'open' : p))
    })
    return off
  }, [])

  // 每次 messages 变化都自动滚到底 —— 桌宠对话短场景下用户始终想看最新。
  // 想看历史用键盘 / 滚轮自己滚。
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isWaitingForReply])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      setChatPhase((p) => (p === 'open' ? 'closing' : p))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * M9-1: Pointer Capture drag —— 取代旧 window-level mousemove/mouseup listener。
   *
   * 旧问题：window 监听只在 pet panel 收到 mouseevent 时 fire。我们的 panel 是
   * frameless transparent BrowserWindow（非 NSPanel —— 见 main/index.ts），
   * user 快甩 cursor 出 panel 边界 → window 收不到 mousemove → dragRef.lastX/Y
   * 不更新 → pet 不再 follow cursor → 视觉上"甩丢了"。
   *
   * 新方案：onPointerDown 时调 setPointerCapture(pointerId) 把该 pointerId 的
   * 后续所有 event 强制 route 到 pet 元素（不管 cursor 在屏幕哪个角落）。capture
   * 在 pointerup / pointercancel 时自动释放。
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // M9-3 fix: 任何 pointerdown 立即 wake from sleep（main 端 wakeFromSleep
    // no-op when not in sleep chain，cheap 安全）。原本只有 drag/chat 唤醒，
    // 单击 pet 时 click burst 延后 250ms 才 toggle chat，期间 pet 还显示 sleeping
    // 让 user 困惑"点了没反应"。
    window.api.petWake()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const ref = dragRef.current
    if (!ref || e.pointerId !== ref.pointerId) return
    const total = Math.hypot(e.screenX - ref.startX, e.screenY - ref.startY)
    if (total < DRAG_THRESHOLD_PX) return
    ref.moved = true
    const dx = e.screenX - ref.lastX
    const dy = e.screenY - ref.lastY
    if (dx !== 0 || dy !== 0) {
      window.api.windowMoveDelta(dx, dy)
      ref.lastX = e.screenX
      ref.lastY = e.screenY
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const ref = dragRef.current
    if (!ref || e.pointerId !== ref.pointerId) return
    dragRef.current = null
    // pointerup 自动 release capture（不需要显式 releasePointerCapture）
    // M9-5a Officer #2 / Architect W3 / Tester B1+B2 fix:
    // mini 模式下 pointerup **永远**走 setPetMode('full') —— 不论 ref.moved.
    // 之前的 bug: ref.moved=true 走 windowDragEnd → main 看 petMode='mini' early return
    // → mini panel 拖到屏中央就卡死、手抖 5px+ 单击也 silent dead。统一行为：
    // mini 模式下 click 也好、drag 也好都 → 回 full（drag 路径的"snap"语义在 mini→full
    // 不存在，永远应该回 full）。
    if (petMode === 'mini') {
      window.api.setPetMode('full')
      return
    }
    if (ref.moved) {
      // full 模式下 drag end 通知 main 检测是否拖到右边 → snap to mini
      window.api.windowDragEnd()
      return
    }
    handleClickBurst()
  }

  /**
   * M9-2: 累计 click burst 决定 action（单击 toggle chat / 双击 poke / 4+ startled）
   */
  const handleClickBurst = (): void => {
    const now = Date.now()
    const click = clickRef.current
    // 4+ 连击 within burst window → 立即 startled，不等 timer
    if (click && now - click.firstAt < STARTLED_BURST_MS && click.count + 1 >= 4) {
      if (click.timer) clearTimeout(click.timer)
      clickRef.current = null
      window.api.petStartled()
      return
    }
    // 计入当前 burst 或开新 burst
    const burstFirstAt = click && now - click.firstAt < STARTLED_BURST_MS ? click.firstAt : now
    const count = click && now - click.firstAt < STARTLED_BURST_MS ? click.count + 1 : 1
    if (click?.timer) clearTimeout(click.timer)
    const timer = setTimeout(() => {
      clickRef.current = null
      if (count === 1) {
        // 单击 → toggle chat (250ms 后才执行 —— 是 trade-off 让双击判定可行)
        const current = chatPhaseRef.current
        if (current === 'closed') {
          setChatPhase('open')
          window.api.setChatOpen(true)
        } else if (current === 'open') {
          setChatPhase('closing')
          // closing 动画完成后 handleConvAnimEnd 调 setChatOpen(false) 缩窗口
        }
      } else {
        // 2-3 连击 → poke
        window.api.petPoke()
      }
    }, POKE_DETECT_MS)
    clickRef.current = { count, firstAt: burstFirstAt, timer }
  }

  /** Pointer 被系统抢走（如系统弹 dialog） → 当 cancel 处理，丢弃 dragRef */
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>): void => {
    const ref = dragRef.current
    if (!ref || e.pointerId !== ref.pointerId) return
    dragRef.current = null
  }

  const handleConvAnimEnd = (e: React.AnimationEvent): void => {
    if (e.animationName !== 'conv-fade-out') return
    setChatPhase('closed')
    window.api.setChatOpen(false)
  }

  /**
   * Submit 分流：
   *  - missing + 像 key → submitKey（user 消息只显示遮罩，不打明文 key 到列表）
   *  - missing + 不像 key → 用户消息照常显示 + 追加一条 AI 提示
   *  - ready → 正常对话流
   */
  const submitChat = (): void => {
    const text = draft.trim()
    if (!text) return

    // S2 fix #1 (part): 新 turn 开始前清掉上 turn 还 running 的 msg-tool 卡 (abort 后
    // tool-result 不会再来, 不清会卡 "运行中"). 复用 sweepRunningToolMessages.
    sweepRunningToolMessages()

    if (keyState === 'missing') {
      const detect = detectProvider(text)
      if (detect.kind === 'detected' || detect.kind === 'ambiguous') {
        const provider =
          detect.kind === 'detected' ? detect.provider : detect.defaultPick
        const providerLabel = PROVIDERS[provider].label
        const ambiguousNote =
          detect.kind === 'ambiguous'
            ? `（sk- 前缀在 ${detect.candidates
                .map((p) => PROVIDERS[p].label)
                .join(' / ')} 都用，默认按 ${providerLabel} 试；如果是另一个去设置 ⌘+, 改 provider）`
            : ''
        setMessages((prev) => [
          ...prev,
          {
            id: msgIdRef.current++,
            role: 'user',
            text: `🔑 (识别为 ${providerLabel}, 加密保存中…)${ambiguousNote}`,
            status: 'done'
          }
        ])
        // **关键**: 走 submitProviderKey 不走 legacy submitKey (后者写死 anthropic).
        // main 端会自动 setSelectedModel(defaultModelForProvider(provider)) 防止
        // "key 配了但 model 还选 Claude → no-api-key" 经典坑.
        window.api.submitProviderKey(provider, text.trim())
      } else {
        // unknown —— user 消息照常 push（含遮罩 / 明文），但 NOT_KEY_HINT 末尾去重
        // 避免用户连输几条非 key 文本时同一句 hint 刷屏
        const isPartialKey = /sk-|xai-|AIza/.test(text)
        const userText = isPartialKey ? '🔑 (输入像 API key 但格式不完整)' : text
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          const hintAlreadyShown = last?.role === 'ai' && last.text === NOT_KEY_HINT
          const userMsg: ChatMessage = {
            id: msgIdRef.current++,
            role: 'user',
            text: userText,
            status: 'done'
          }
          if (hintAlreadyShown) return [...prev, userMsg]
          const hintMsg: ChatMessage = {
            id: msgIdRef.current++,
            role: 'ai',
            text: NOT_KEY_HINT,
            status: 'done'
          }
          return [...prev, userMsg, hintMsg]
        })
      }
      setDraft('')
      return
    }

    setMessages((prev) => [...prev, { id: msgIdRef.current++, role: 'user', text, status: 'done' }])
    window.api.submitChat(text)
    setDraft('')
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submitChat()
    }
  }

  // GIF 选择优先级（M8 + LLM 流）：
  //   LLM error → AI 表演动画 (M8 set_pet_animation) → LLM thinking/success
  //   → sleep → 活动识别 → idle 变体池
  // M8: AI 调 set_pet_animation 时 stateMachine 转到 juggling/sweeping/etc
  // priority 5 > thinking priority 2 → 自动覆盖 thinking，让动画播完 minMs cycle。
  let gifUrl: string
  if (state === 'error') {
    gifUrl = errorGif
  } else if (state === 'juggling') {
    gifUrl = jugglingGif
  } else if (state === 'sweeping') {
    gifUrl = sweepingGif
  } else if (state === 'conducting') {
    gifUrl = conductingGif
  } else if (state === 'grooving') {
    gifUrl = headphonesGif
  } else if (state === 'celebrating') {
    gifUrl = happyGif
  } else if (state === 'carrying') {
    gifUrl = carryingGif
  } else if (state === 'ultrathink') {
    gifUrl = ultrathinkSvg
  } else if (state === 'poked') {
    gifUrl = reactDoubleJumpGif
  } else if (state === 'looking_around') {
    gifUrl = reactAnnoyedGif
  } else if (state === 'thinking') {
    gifUrl = thinkingGif
  } else if (state === 'success') {
    gifUrl = happyGif
  } else if (state === 'yawning') {
    gifUrl = yawningSvg
  } else if (state === 'dozing') {
    gifUrl = dozingSvg
  } else if (state === 'collapsing') {
    gifUrl = collapsingSvg
  } else if (state === 'waking') {
    gifUrl = wakingSvg
  } else if (state === 'sleep') {
    gifUrl = sleepingGif
  } else if (activity !== 'idle') {
    gifUrl = ACTIVITY_GIF[activity]
  } else {
    gifUrl = IDLE_POOL[idleVariantIdx] ?? IDLE_POOL[0]
  }

  // 启动时预加载所有 GIF —— 让后续 onLoad 几乎同步触发（cache 命中），避免第一次切换
  // 时还要等 ~50ms 网络/磁盘解码。M8 加 sleepingGif（PetState 'sleep'）
  useEffect(() => {
    const all = [
      ...IDLE_POOL,
      ...Object.values(ACTIVITY_GIF),
      thinkingGif,
      happyGif,
      errorGif,
      sleepingGif,
      reactDoubleJumpGif,
      reactAnnoyedGif,
      yawningSvg,
      dozingSvg,
      collapsingSvg,
      wakingSvg,
      // v0.4.5+ Batch 1: mini-mode 反应 GIF 预热, 防第一次切到 mini-peek/happy/alert
      // 时 1-frame 透明闪 (Chromium 第一次 decode GIF 有 ~50ms 延迟)
      miniPeekGif,
      miniHappyGif,
      miniAlertGif,
      // v0.4.5+ Batch 2: 通知 GIF (full mode 头顶弹) 也预热, 防首次"检查更新"
      // 发现新版本时 1-frame 闪
      notificationGif
    ]
    all.forEach((url) => {
      const img = new Image()
      img.src = url
    })
  }, [])

  // GIF 切换调度：计算 gifUrl 跟 front 比较，不同就触发 cross-fade。
  // LLM 流状态（thinking/happy/error）bypass fade 立即换 front url，保响应感。
  // 普通切换：把新 url 塞 back 层 → onLoad 触发 swap frontIdx → CSS opacity ramp 自动跑。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const front = urls[frontIdx]
    if (gifUrl === front) return
    if (LLM_FLOW_GIFS.has(gifUrl)) {
      pendingBackRef.current = null
      setUrls((cur) => {
        const next = [...cur] as [string, string]
        next[frontIdx] = gifUrl
        return next
      })
      return
    }
    const backIdx = (1 - frontIdx) as 0 | 1
    if (urls[backIdx] === gifUrl) return // 已经塞过 back，等 onLoad
    pendingBackRef.current = gifUrl
    setUrls((cur) => {
      const next = [...cur] as [string, string]
      next[backIdx] = gifUrl
      return next
    })
  }, [gifUrl, frontIdx, urls])
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * back layer 的 onLoad 处理：只在「这次切换是我们刚请求的」时 swap frontIdx。
   * - idx === frontIdx 时是 front 层 onLoad 不触发
   * - urls[idx] !== pendingBackRef 时是别的 url 残留 onLoad（如 mount 初始），不触发
   * - requestAnimationFrame 让 swap 跟 paint cycle 对齐，避免 setSrc → opacity 同帧 race
   */
  const handleImgLoad = (idx: 0 | 1) => (): void => {
    if (idx === frontIdx) return
    if (urls[idx] !== pendingBackRef.current) return
    pendingBackRef.current = null
    requestAnimationFrame(() => setFrontIdx(idx))
  }
  // v0.4.0 改动 1: vision + tavily modal 已全部移到 Settings 窗口管理.
  // chat 顶部只剩 1 颗模型 pill, 不再保留 helpers / labels / handlers.

  // v0.4.0 [A] anyToolRunning — pet 容器 .pet-busy-ring 接 running tool state
  const anyToolRunning = messages.some(
    (m) => m.tool && m.tool.status === 'running'
  )

  // keyState 还没就位时禁用：避免「user msg / no-api-key 错误 / 迎宾」三连闪
  // 等 AI 回复时禁用：避免连点 submit 让旧 stream 被 token 屏蔽但仍在烧 Anthropic token
  const isInputDisabled = keyState === null || isWaitingForReply
  const placeholder =
    keyState === null
      ? t('chat.placeholder_initializing')
      : isWaitingForReply
        ? t('chat.placeholder_replying')
        : keyState === 'missing'
          ? t('chat.placeholder_paste_key')
          : t('chat.empty_placeholder_dots')

  return (
    <div
      className="stage"
      // v0.4.0 改动 2 修: drag handlers 从 .pet (240×240) 上移到 .stage (全窗口) —
      // 之前 chat 开时窗口 500×280, .pet 只占右下 240, 用户拖到左侧对话区无事件,
      // overlay 不显示 → 用户以为"拖拽功能失效". 移到 .stage 全窗口都接 drag.
      onDragEnter={(e) => {
        e.preventDefault()
        console.log('[dnd] dragenter (React)', { types: Array.from(e.dataTransfer.types) })
        dragDepthRef.current += 1
        if (dragDepthRef.current === 1) setDragOver(true)
      }}
      onDragOver={(e) => {
        // 必须 preventDefault 才能让 onDrop 触发
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        console.log('[dnd] drop (React)', {
          fileCount: e.dataTransfer.files.length,
          types: Array.from(e.dataTransfer.types)
        })
        dragDepthRef.current = 0
        setDragOver(false)
        // Electron 32+ 移除 File.path → 用 window.api.getPathForFile() 走 preload bridge
        // 拿绝对路径. 之前直接读 (f as File & { path?: string }).path 永远 undefined,
        // → main 端 dropFiles 安全检查 + preview → summary → 走正常 submitChat 流
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.api.getPathForFile(f))
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
        console.log('[dnd] drop paths', paths)
        if (paths.length === 0) return
        void (async (): Promise<void> => {
          const result = await window.api.dropFiles(paths)
          if (result.accepted.length === 0 && result.rejected.length > 0) {
            // 全部 reject — 不发 chat, 加 system 消息让用户看到原因
            setMessages((prev) => [
              ...prev,
              {
                id: msgIdRef.current++,
                role: 'system' as const,
                text:
                  `⚠️ 拖入的 ${result.rejected.length} 个文件全部被拒:\n` +
                  result.rejected.map((r) => `• ${r.path} — ${r.reason}`).join('\n'),
                status: 'done' as const
              }
            ])
            return
          }
          // 有接受的: 推 summary 当 user msg, 也走 chat:submit 让 AI 收到完整上下文.
          setMessages((prev) => [
            ...prev,
            {
              id: msgIdRef.current++,
              role: 'user' as const,
              text: result.summary,
              status: 'done' as const
            }
          ])
          window.api.submitChat(result.summary)
        })()
      }}
    >
      {isConvMounted && (
        <div
          ref={convRef}
          className={chatPhase === 'closing' ? 'conversation closing' : 'conversation'}
          onAnimationEnd={handleConvAnimEnd}
        >
          <div ref={messagesRef} className="messages">
            {messages.length === 0 ? (
              <div className="hint">
                {t('chat.empty_placeholder')}
                <br />
                {t('chat.kbd_send_close', 'ENTER', 'ESC')}
              </div>
            ) : (
              <>
                {messages.map((m) => {
                  // v0.4.0 [A] msg-tool: AI 调 tool 状态卡 (running 显 loading dots, done 显 ✓ 绿勾)
                  if (m.role === 'tool' && m.tool) {
                    const isDone = m.tool.status === 'done'
                    const isError = m.tool.status === 'error'
                    const display = getToolDisplay(m.tool.name)
                    return (
                      <div key={m.id} className="msg-tool">
                        <span className="msg-tool-icon">{display.icon}</span>
                        <span className="msg-tool-name">{display.label}</span>
                        <span className="msg-tool-sep">·</span>
                        <span
                          className="msg-tool-status"
                          data-state={m.tool.status}
                        >
                          {isError ? t('tool.status.error') : isDone ? t('tool.status.done') : t('tool.status.running')}
                          {isDone && <span className="msg-tool-check">✓</span>}
                          {!isDone && !isError && (
                            <span className="msg-tool-loading">
                              <span className="msg-tool-loading-dot" />
                              <span className="msg-tool-loading-dot" />
                              <span className="msg-tool-loading-dot" />
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  }
                  // v0.4.0 [E] msg-system: 灰 muted 居中提示 (季节装扮 / 系统侧)
                  if (m.role === 'system') {
                    return (
                      <div key={m.id} className="msg-system">
                        <span className="msg-system-dot" />
                        <span>{m.text}</span>
                      </div>
                    )
                  }
                  // v0.4.0 S5.2 [D] msg-file: AI 处理完拖入文件 → 卡片显示文件信息
                  // 触发: main 端 DnD handler 完成 (S6.4) 后通过 chat:message-file 推, 暂时
                  // 数据通道空, 仅 render 分支就位. m.file 字段 ChatMessage 已扩展.
                  if (m.file) {
                    return (
                      <div key={m.id} className={`msg msg-${m.role}`}>
                        <div className="msg-file">
                          <div className="msg-file-head">
                            <span className="msg-file-ext">{m.file.ext.toUpperCase()}</span>
                            <span className="msg-file-name">{m.file.name}</span>
                          </div>
                          {m.text && <div className="msg-file-summary">{m.text}</div>}
                          {m.file.summary && (
                            <div className="msg-file-summary">{m.file.summary}</div>
                          )}
                        </div>
                      </div>
                    )
                  }
                  // user / ai: 原 msg-bubble 不变
                  return (
                    <div key={m.id} className={`msg msg-${m.role}`}>
                      <div className="msg-bubble" data-status={m.status}>
                        {m.text}
                        {m.status === 'streaming' && <span className="cursor-blink" />}
                      </div>
                    </div>
                  )
                })}
                {isWaitingForReply && (
                  <div className="msg msg-ai">
                    <div className="typing" aria-label="桌宠在打字">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {/* v0.4.0 改动 4 完整: model pill 触发 modal overlay (用户要"放在额外弹
              出的方框里"). pill 只触发, modal 实体渲染在外层 (vision-modal-overlay). */}
          <div className="vision-bar">
            <button
              type="button"
              className="vision-pill vision-pill--on"
              onClick={() => setModelDropdownOpen(true)}
              title="点击切换 model"
            >
              <span className="vision-pill-ico">🤖</span>
              {currentModel ? currentModel.modelId : '加载中…'}
              <span className="model-dropdown-caret">▾</span>
            </button>
            {/* v0.4.3+ chat 输入栏 "📂 导入" 按钮 — 替代拖拽 (透明 NSPanel 不接 HTML5
                drop). 点击 → main 弹系统文件选择器 multi-select → tray:drop-files
                channel 推回 (跟 tray 拖文件同一份后续 pipeline). */}
            <button
              type="button"
              className="vision-pill vision-pill--on import-pill"
              onClick={() => window.api.openImportFilesDialog()}
              title={t('chat.import_files_title')}
            >
              <span className="vision-pill-ico">📂</span>
            </button>
          </div>
          <input
            className="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            autoFocus
            disabled={isInputDisabled}
            placeholder={placeholder}
          />
        </div>
      )}
      {/* v0.4.0 改动 1: vision modal + tavily modal 已删 — 全部迁移到 Settings 窗口 */}
      {/* v0.4.0 改动 4: 模型切换 modal — 用户要"放在额外弹出的方框里", 不是 inline dropdown */}
      {modelDropdownOpen && (
        <div
          className="vision-modal-overlay"
          onClick={() => setModelDropdownOpen(false)}
        >
          <div
            className="vision-modal model-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vision-modal-title">切换模型</div>
            <div className="vision-modal-body model-modal-body">
              {PROVIDER_ORDER.filter((p) => modelsByProvider[p]?.length).map((p) => (
                <div key={p} className="model-dropdown-group">
                  <div className="model-dropdown-group-label">{PROVIDERS[p].label}</div>
                  {(modelsByProvider[p] ?? []).map((modelId) => {
                    const isActive =
                      currentModel?.provider === p && currentModel?.modelId === modelId
                    return (
                      <button
                        key={modelId}
                        type="button"
                        className={
                          isActive
                            ? 'model-dropdown-item model-dropdown-item--active'
                            : 'model-dropdown-item'
                        }
                        onClick={() => {
                          window.api.setSelectedModel({ provider: p, modelId })
                          setModelDropdownOpen(false)
                        }}
                      >
                        {isActive && <span className="model-dropdown-check">✓</span>}
                        {modelId}
                      </button>
                    )
                  })}
                </div>
              ))}
              {PROVIDER_ORDER.filter((p) => modelsByProvider[p]?.length).length === 0 && (
                <div className="model-dropdown-empty">
                  还没拉到 model 列表 — 检查 Settings 里 API key, 或网络.
                </div>
              )}
            </div>
            <div className="vision-modal-actions">
              <button
                type="button"
                className="vision-modal-btn-cancel"
                onClick={() => setModelDropdownOpen(false)}
              >
                {t('approval.close')}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingApproval && (
        <div className="vision-modal-overlay">
          <div className="vision-modal approval-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vision-modal-title">
              {t('approval.title')}
              {approvalQueue.length > 1 && (
                <span className="approval-queue-badge">
                  {' '}
                  {t('approval.queue_badge', String(approvalQueue.length))}
                </span>
              )}
            </div>
            <div className="vision-modal-body">
              <p className="approval-summary">{pendingApproval.summary}</p>
              {pendingApproval.path && (
                <p className="approval-detail">
                  <b>{t('approval.label_path')}</b>
                  <code>{pendingApproval.path}</code>
                </p>
              )}
              {pendingApproval.paths && pendingApproval.paths.length > 0 && (
                <div className="approval-detail">
                  <b>{t('approval.label_paths', String(pendingApproval.paths.length))}</b>
                  <ul className="approval-paths-list">
                    {pendingApproval.paths.map((p) => (
                      <li key={p}>
                        <code>{p}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {pendingApproval.command && (
                <p className="approval-detail">
                  <b>{t('approval.label_command')}</b>
                  <code>{pendingApproval.command}</code>
                </p>
              )}
              {pendingApproval.contentPreview && (
                <p className="approval-detail">
                  <b>{t('approval.label_content_preview')}</b>
                  <code className="approval-content-preview">
                    {pendingApproval.contentPreview}
                  </code>
                </p>
              )}
              <p className="approval-hint">
                {t('approval.hint_auto_deny', pendingApproval.tool)}
              </p>
            </div>
            <div className="approval-actions">
              <button
                type="button"
                className="vision-modal-btn-cancel"
                onClick={() => handleApprovalDecision('deny')}
              >
                {pendingApproval.paths && pendingApproval.paths.length > 1
                  ? t('approval.deny_batch')
                  : t('approval.deny')}
              </button>
              <button
                type="button"
                className="approval-btn-once"
                onClick={() => handleApprovalDecision('allow-once')}
              >
                {pendingApproval.paths && pendingApproval.paths.length > 1
                  ? t('approval.allow_batch', String(pendingApproval.paths.length))
                  : t('approval.allow_once')}
              </button>
              {/* 单 path 才显示 trust-dir-* 两键; 批量隐藏 (审核官员 pre-review #2:
                  跨多个父目录一次性 persistent trust 用户无法 informed-consent) */}
              {pendingApproval.path &&
                !(pendingApproval.paths && pendingApproval.paths.length > 1) && (
                  <>
                    <button
                      type="button"
                      className="approval-btn-trust-session"
                      onClick={() => handleApprovalDecision('trust-dir-session')}
                    >
                      {t('approval.trust_dir_session')}
                    </button>
                    <button
                      type="button"
                      className="approval-btn-trust-permanent"
                      onClick={() => handleApprovalDecision('trust-dir-permanent')}
                    >
                      {t('approval.trust_dir_persistent')}
                    </button>
                  </>
                )}
            </div>
          </div>
        </div>
      )}
      <div
        ref={petRef}
        className={petMode === 'mini' ? 'pet pet-mini' : 'pet'}
        data-state={state}
        data-mode={petMode}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {/* v0.4.0 S4.2 [A] pet-busy-ring — AI 调 tool 时 pet 周围珊瑚虚线闪烁,
            消息流中 m.tool.status==='running' 至少 1 个就显示. Mini 模式也显示 —
            CSS `inset:6px` + `clip-path` 自然适配 64×64. */}
        {anyToolRunning && <div className="pet-busy-ring" aria-hidden="true" />}
        {/* v0.4.0 S4.3 [A] pet-toast — tool 'end' 时 2.7s 头顶字条. CSS 已带
            pet-pop-in + fade-out 复合 keyframe. */}
        {petToast && (
          <div className="pet-toast" key={petToast.id}>
            {petToast.text}
          </div>
        )}
        {/* v0.4.0 S4.4 [B] pet-emote-hint — activity 切换时 4s 表情气泡.
            companion mode (🎭 pill) 开启时才显示, 否则被 useEffect gate 拦住. */}
        {emoteHint && <div className="pet-emote-hint">{emoteHint}</div>}
        {/* v0.4.5+ Batch 2: update:available 真有新版时桌宠头顶弹通知 GIF ~3.6s.
            key={notifyPop.id} 让 React 重挂 <img> 让 GIF 从 frame 0 重启 (多次
            "检查更新" 也能 restart). 点击 → openExternal(release URL) + 自关.
            仅 full mode 渲染; mini mode 走上面 <img src> ternary 用 alert.gif. */}
        {petMode === 'full' && notifyPop && (
          <img
            className="pet-notification-pop"
            key={notifyPop.id}
            src={notificationGif}
            alt=""
            draggable={false}
            onClick={() => {
              void window.api.openExternal(notifyPop.url)
              setNotifyPop(null)
              if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current)
            }}
          />
        )}
        {/* v0.4.0 S6.2 [D] pet-drop overlay — 用户拖文件到 pet 时弹大字提示
            "松手喂我". 实际文件处理 S6.3-S6.5 后续接入. */}
        {dragOver && (
          <div className="pet-drop">
            <div className="pet-drop-big">📂</div>
            <div className="pet-drop-hint">{t('drop.overlay_text')}</div>
          </div>
        )}
        {/* M9-5a Mini mode：单 img 渲染. v0.4.3+: 进 mini 头 1.6s 播 enter.gif 当过渡,
            之后 settle 到 mini-idle. Sub-wave B 加 hover peek / mini state→gif 映射.
            Mini 模式下完全独立于下方 IdleFollow + dual-img 体系. */}
        {petMode === 'mini' && (
          <img
            src={
              miniEntering
                ? miniEnterGif
                : state === 'error'
                  ? miniAlertGif
                  : notifyPop
                    ? miniAlertGif // Batch 2: 通知期 mini 复用 alert.gif (无 96×96 GIF 空间)
                    : state === 'success'
                      ? miniHappyGif
                      : miniPeeking
                        ? miniPeekGif
                        : miniIdleGif
            }
            alt=""
            draggable={false}
            style={{ opacity: 1 }}
          />
        )}
        {/* M9-4 IdleFollow inline SVG layer —— state=idle && activity=idle 时显示，
            内部 `#eyes-js`/`#body-js`/`#shadow-js` group 由 rAF loop 直接 mutate
            transform 实现 eye tracking + body lean + shadow stretch。
            其他状态时 opacity 0，让下面 dual-img 接管。 */}
        <IdleFollowSvg
          ref={idleFollowSvgRef}
          style={{
            opacity:
              petMode === 'full' && state === 'idle' && activity === 'idle' ? 1 : 0,
            transition: `opacity ${FADE_HALF_MS}ms ${FADE_EASING}`
          }}
        />
        {/* 双层 cross-fade：两个 absolute 叠加，opacity 互补 ramp。
            会同时跑 0→1 和 1→0，旧 GIF 在 fade-out 期间继续 paint 旧帧（不会突然透明）。
            onLoad 驱动 swap：新 GIF decode 完才 ramp，消除 Chromium <img src> 重置的 1-2 帧透明窗口。
            两层都常驻 mount，避免 unmount/remount 抖动；通过 frontIdx 切角色。
            M9-4: idle-follow 模式时整组 img 强制 opacity 0 让 SVG layer 占主导。 */}
        <img
          src={urls[0]}
          alt=""
          draggable={false}
          onLoad={handleImgLoad(0)}
          style={{
            opacity:
              petMode === 'mini'
                ? 0
                : state === 'idle' && activity === 'idle'
                  ? 0
                  : frontIdx === 0
                    ? 1
                    : 0,
            transition: `opacity ${FADE_HALF_MS}ms ${FADE_EASING}`
          }}
        />
        <img
          src={urls[1]}
          alt=""
          draggable={false}
          onLoad={handleImgLoad(1)}
          style={{
            opacity:
              petMode === 'mini'
                ? 0
                : state === 'idle' && activity === 'idle'
                  ? 0
                  : frontIdx === 1
                    ? 1
                    : 0,
            transition: `opacity ${FADE_HALF_MS}ms ${FADE_EASING}`
          }}
        />
      </div>
    </div>
  )
}

export default App
