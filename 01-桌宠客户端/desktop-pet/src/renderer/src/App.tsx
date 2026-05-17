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
import { useEffect, useRef, useState } from 'react'
import type { PetState } from '../../shared/pet-state'
import type { ActivityState, ChatError, KeyState } from '../../shared/chat-types'
import type { VisionState } from '../../shared/vision-types'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/approval-types'
import type { TavilyState } from '../../shared/tavily-types'
// idle 池 6 种"无聊时的小动作"，闲态随机切
import idleGif from '@themes/clawd-dev/clawd-idle.gif'
import idleReadingGif from '@themes/clawd-dev/clawd-idle-reading.gif'
import sweepingGif from '@themes/clawd-dev/clawd-sweeping.gif'
import jugglingGif from '@themes/clawd-dev/clawd-juggling.gif'
import buildingGif from '@themes/clawd-dev/clawd-building.gif'
import conductingGif from '@themes/clawd-dev/clawd-conducting.gif'
import sleepingGif from '@themes/clawd-dev/clawd-sleeping.gif'
// activity → GIF 映射：识别到不同活动时桌宠"陪你做同样的事"
import typingGif from '@themes/clawd-dev/clawd-typing.gif'
import debuggerGif from '@themes/clawd-dev/clawd-debugger.gif'
import headphonesGif from '@themes/clawd-dev/clawd-headphones-groove.gif'
// LLM 流状态
import thinkingGif from '@themes/clawd-dev/clawd-thinking.gif'
import happyGif from '@themes/clawd-dev/clawd-happy.gif'
import errorGif from '@themes/clawd-dev/clawd-error.gif'

const DRAG_THRESHOLD_PX = 5

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
  '嗨，第一次见面 🦀 我是 Claw。要跟我聊天得先有把 Anthropic API key —— 把它（sk-ant- 开头那串长字符串）粘到下面发给我，我会本地加密保存，不会发到任何地方。'

// 中性文案 —— 不暗示「已加密存好」，因为 Linux 无 keyring 时存盘会失败但内存仍可用，
// 后续 'key-not-persisted' 错误气泡会单独说明「下次启动会丢」，两条不互相打脸
const KEY_STORED_TEXT = '钥匙记下了，咱们可以聊了 🦀'

const KEY_RESET_PROMPT = '🔑 钥匙没了或被拒了 —— 再贴一个 sk-ant-... 给我？'

const NOT_KEY_HINT =
  '🤔 这看着不像 Anthropic API key（要 sk-ant- 开头的长字符串）。去 console.anthropic.com 拿到 key 再贴过来～'

/**
 * 渲染层校验 —— 跟 main 端 looksLikeApiKey 同样规则（{20,200}），避免 renderer 通过
 * 但 main 拒导致用户卡在「🔑 已提交」气泡（cr W1 修复）。
 *
 * M7-5 注：本函数仅 Anthropic 单 provider 时代 chat-paste 后门用 —— first-time
 * onboarding 让 user 直接粘 sk-ant-... 到对话框激活桌宠。其它 5 个 provider
 * （OpenAI / Google / xAI / DeepSeek / ByteDance）的 key 走 Settings 面板
 * (`⌘+,`) 的 submitProviderKey IPC —— chat-paste 不识别那些前缀。这是有意保留的
 * Anthropic-优先 onboarding UX；多 provider 用户应当用 Settings。
 */
function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,200}$/.test(text.trim())
}

interface ChatMessage {
  id: number
  role: 'user' | 'ai'
  text: string
  status: 'streaming' | 'done' | 'error'
}

function chatErrorText(err: ChatError): string {
  switch (err.kind) {
    case 'no-api-key':
      return '⚠️ API key 还没配 —— 重新贴一个 sk-ant-... 给我'
    case 'invalid-api-key':
      return '⚠️ 这个 API key 被 Anthropic 拒了，重新贴一个吧'
    case 'rate-limited':
      return err.retryAfterSec ? `⏱️ 太快了，${err.retryAfterSec}s 后再试` : '⏱️ 请求过快，等等再问'
    case 'overloaded':
      return '😵 Claude 现在很忙，稍等再问'
    case 'network':
      return '🌐 连不上 Anthropic，检查下网络'
    case 'key-not-persisted':
      return '⚠️ 系统没装加密后端，这次能聊但下次启动 key 会丢（Linux 装个 libsecret / gnome-keyring 就好）'
    case 'key-format-invalid':
      return '⚠️ 这个 key 格式不对（要 sk-ant- 开头，长度 20-200 字符），检查下复制有没有带空格 / 多余字符'
    case 'api':
      return `⚠️ ${err.message}`
    default:
      return `⚠️ 出错了：${err.message}`
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
  // idle 6 变体池索引（仅 stateMachine=idle + activity=idle 时玩）
  const [idleVariantIdx, setIdleVariantIdx] = useState(0)
  // 双层 <img> cross-fade：两个 absolute 叠加，frontIdx 指当前显示的那层
  // 切换时把新 url 塞 back 层（opacity 0），等 onLoad（新 GIF 解码完）→ swap frontIdx
  // → CSS opacity transition 让 back 0→1 + front 1→0 同时 ramp，永远不出现透明窗口
  const [frontIdx, setFrontIdx] = useState<0 | 1>(0)
  const [urls, setUrls] = useState<[string, string]>([IDLE_POOL[0], IDLE_POOL[0]])
  // —— M4-A-4 视觉感知 state（agentic：AI 自主决定何时截屏，无 progress chip）——
  const [visionState, setVisionState] = useState<VisionState | null>(null)
  // 隐私同意 modal 开关
  const [visionModalOpen, setVisionModalOpen] = useState(false)
  // —— M4-C 高风险 tool 待审批的请求（null = 当前无 pending） ——
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  // —— M4-D-1 Tavily search API key state ——
  const [tavilyState, setTavilyState] = useState<TavilyState | null>(null)
  const [tavilyModalOpen, setTavilyModalOpen] = useState(false)
  const [tavilyKeyDraft, setTavilyKeyDraft] = useState('')
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
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)

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
    window.api.requestKeyState()
    return off
  }, [])

  // —— vision state 订阅 + 启动主动拉一次（同 keyState 防 race 模式）——
  useEffect(() => {
    const off = window.api.onVisionState((s) => setVisionState(s))
    window.api.requestVisionState()
    return off
  }, [])

  // —— 订阅 main 端的 approval 请求 ——
  // 一次只支持一个 pending —— 后来的覆盖前面的（理论上 main 端 serial 处理 tool calls，
  // 不会出现并发；这里做 last-wins 防御）
  useEffect(() => {
    const off = window.api.onApprovalRequest((req) => setPendingApproval(req))
    return off
  }, [])

  // —— Tavily state 订阅 ——
  useEffect(() => {
    const off = window.api.onTavilyState((s) => setTavilyState(s))
    window.api.requestTavilyState()
    return off
  }, [])

  // —— M5-2 用户在设置面板清空对话历史 → 同步清 UI 消息列表 ——
  useEffect(() => {
    const off = window.api.onChatHistoryCleared(() => {
      setMessages([])
    })
    return off
  }, [])

  const handleApprovalDecision = (decision: ApprovalDecision): void => {
    if (!pendingApproval) return
    // trust-dir-* 决策需要目录路径 —— 从 req.path 推出（path 是文件或目录绝对路径）
    const dirToTrust = pendingApproval.path
      ? pendingApproval.path.endsWith('/')
        ? pendingApproval.path
        : pendingApproval.path.replace(/\/[^/]*$/, '') || '/'
      : undefined
    window.api.sendApprovalResponse(pendingApproval.id, decision, dirToTrust)
    setPendingApproval(null)
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
      setMessages((prev) => [
        ...prev,
        { id: msgIdRef.current++, role: 'ai', text: chatErrorText(err), status: 'error' }
      ])
    })
    return off
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

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    }
  }

  useEffect(() => {
    // renderer 不再做 hit-test 切 setIgnoreMouse —— 主进程 cursorWatcher 用 panel
    // bounds 整体粒度控制。原因：NSPanel non-activating 在别的 app 前台时收不到
    // mousemove forward，原来的精细 hit-test 失灵，导致"VS Code 前台时点桌宠点不开"。
    // trade-off：panel 透明区域 click 不再穿透到底层 app，但区域小（< 12% 面积）。
    const onMove = (ev: MouseEvent): void => {
      if (!dragRef.current) return
      const ref = dragRef.current
      const total = Math.hypot(ev.screenX - ref.startX, ev.screenY - ref.startY)
      if (total < DRAG_THRESHOLD_PX) return
      ref.moved = true
      const dx = ev.screenX - ref.lastX
      const dy = ev.screenY - ref.lastY
      if (dx !== 0 || dy !== 0) {
        window.api.windowMoveDelta(dx, dy)
        ref.lastX = ev.screenX
        ref.lastY = ev.screenY
      }
    }

    const onUp = (): void => {
      const ref = dragRef.current
      dragRef.current = null
      if (!ref || ref.moved) return
      // 用 chatPhaseRef 直读最新 phase，避免 functional setter 路径的 closure 赋值 mystery
      const current = chatPhaseRef.current
      if (current === 'closed') {
        setChatPhase('open')
        window.api.setChatOpen(true)
      } else if (current === 'open') {
        setChatPhase('closing')
        // closing 动画完成后 handleConvAnimEnd 会调 setChatOpen(false) 缩窗口
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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

    if (keyState === 'missing') {
      if (looksLikeApiKey(text)) {
        setMessages((prev) => [
          ...prev,
          {
            id: msgIdRef.current++,
            role: 'user',
            text: '🔑 (已提交 API key，加密保存中…)',
            status: 'done'
          }
        ])
        window.api.submitKey(text)
      } else {
        // 不是有效 key —— user 消息照常 push（含遮罩 / 明文），但 NOT_KEY_HINT 末尾去重
        // 避免用户连输几条非 key 文本时同一句 hint 刷屏
        const isPartialKey = text.includes('sk-ant-')
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
  } else if (state === 'thinking') {
    gifUrl = thinkingGif
  } else if (state === 'success') {
    gifUrl = happyGif
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
      sleepingGif
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
  // —— vision UI helpers ——
  const handleVisionToggleClick = (): void => {
    if (!visionState) return // 还没拿到状态，禁用
    if (visionState.kind === 'disabled-no-consent') {
      // 没 consent：弹隐私 modal
      setVisionModalOpen(true)
    } else if (visionState.kind === 'disabled') {
      // 已 consent + 关 → 直接开
      window.api.setVisionEnabled(true)
    } else {
      // enabled → 关
      window.api.setVisionEnabled(false)
    }
  }

  const handleVisionEnableConfirm = (): void => {
    // consent + enable 主进程一并写入 prefs
    window.api.acceptVisionConsentAndEnable()
    setVisionModalOpen(false)
  }

  const handleVisionModalCancel = (): void => {
    setVisionModalOpen(false)
  }

  const visionLabel = ((): string => {
    if (!visionState) return '...'
    if (visionState.kind === 'enabled') return '👁 允许 AI 看屏'
    if (visionState.kind === 'disabled') return '👁 禁止看屏'
    return '🔒 启用屏幕感知'
  })()

  // —— Tavily UI helpers ——
  const handleTavilyButtonClick = (): void => {
    setTavilyKeyDraft('')
    setTavilyModalOpen(true)
  }

  const handleTavilyKeySubmit = (): void => {
    const trimmed = tavilyKeyDraft.trim()
    if (!trimmed) return
    window.api.submitTavilyKey(trimmed)
    setTavilyModalOpen(false)
    setTavilyKeyDraft('')
  }

  const handleTavilyKeyReset = (): void => {
    window.api.resetTavilyKey()
    setTavilyModalOpen(false)
    setTavilyKeyDraft('')
  }

  const handleTavilyModalCancel = (): void => {
    setTavilyModalOpen(false)
    setTavilyKeyDraft('')
  }

  const tavilyLabel = ((): string => {
    if (!tavilyState) return '...'
    return tavilyState.kind === 'configured' ? '🔍 搜索就绪' : '🔍 设搜索 key'
  })()

  // keyState 还没就位时禁用：避免「user msg / no-api-key 错误 / 迎宾」三连闪
  // 等 AI 回复时禁用：避免连点 submit 让旧 stream 被 token 屏蔽但仍在烧 Anthropic token
  const isInputDisabled = keyState === null || isWaitingForReply
  const placeholder =
    keyState === null
      ? '正在初始化…'
      : isWaitingForReply
        ? 'Claw 正在回复…'
        : keyState === 'missing'
          ? '粘 API key 到这里 (sk-ant-...)'
          : '对桌宠说点啥...'

  return (
    <div className="stage">
      {isConvMounted && (
        <div
          ref={convRef}
          className={chatPhase === 'closing' ? 'conversation closing' : 'conversation'}
          onAnimationEnd={handleConvAnimEnd}
        >
          <div ref={messagesRef} className="messages">
            {messages.length === 0 ? (
              <div className="hint">
                对桌宠说点啥
                <br />
                <span className="kbd">ENTER</span> 发送 · <span className="kbd">ESC</span> 关闭
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div key={m.id} className={`msg msg-${m.role}`}>
                    <div className="msg-bubble" data-status={m.status}>
                      {m.text}
                      {m.status === 'streaming' && <span className="cursor-blink" />}
                    </div>
                  </div>
                ))}
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
          <div className="vision-bar">
            <button
              type="button"
              className="vision-toggle"
              onClick={handleVisionToggleClick}
              disabled={!visionState}
              data-state={visionState?.kind}
            >
              {visionLabel}
            </button>
            <button
              type="button"
              className="vision-toggle"
              onClick={handleTavilyButtonClick}
              disabled={!tavilyState}
              data-state={tavilyState?.kind}
            >
              {tavilyLabel}
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
      {visionModalOpen && (
        <div className="vision-modal-overlay" onClick={handleVisionModalCancel}>
          <div className="vision-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vision-modal-title">启用屏幕感知</div>
            <div className="vision-modal-body">
              <p>每次你发消息时，DeskPet 会截当前屏幕一张全屏图，跟你的消息一起发给：</p>
              <p className="vision-modal-endpoint">Anthropic Claude（带 vision 能力的多模态 AI）</p>
              <p>AI 直接看图回答你的问题。</p>
              <ul>
                <li>截屏 → 仅内存 → base64 编码 → HTTPS 发 Anthropic API</li>
                <li>桌宠自己可能出现在截图里 —— AI 会忽略它</li>
                <li>本地不存截图字节；Anthropic 30 天审核保留期请参考其隐私政策</li>
                <li>不再走自托管 OCR 服务（M4-A-2 pivot）</li>
              </ul>
              <p>可随时关闭；图像 token 计费走你已配置的 Anthropic API key。</p>
            </div>
            <div className="vision-modal-actions">
              <button type="button" className="vision-modal-btn-cancel" onClick={handleVisionModalCancel}>
                取消
              </button>
              <button
                type="button"
                className="vision-modal-btn-ok"
                onClick={handleVisionEnableConfirm}
              >
                我已了解，启用
              </button>
            </div>
          </div>
        </div>
      )}
      {tavilyModalOpen && (
        <div className="vision-modal-overlay" onClick={handleTavilyModalCancel}>
          <div className="vision-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vision-modal-title">搜索 API（Tavily）</div>
            <div className="vision-modal-body">
              <p>
                状态：
                {tavilyState?.kind === 'configured' ? (
                  <b style={{ color: 'var(--coral-deep)' }}>已配置（加密落盘）</b>
                ) : (
                  <b style={{ color: 'var(--muted)' }}>未配置</b>
                )}
              </p>
              <p>
                Tavily 提供 AI 友好的网页搜索（免费 1000 次/月）。配置后 AI 可以在你
                问到需要联网信息时自动调用。
              </p>
              <p>
                获取 key：
                <code className="vision-modal-endpoint">tavily.com</code>{' '}
                注册账号后从 dashboard 拿。格式 <code>tvly-xxxxxxxxxxxx</code>。
              </p>
              <ul>
                <li>safeStorage AES-256 加密落盘（macOS Keychain backed）</li>
                <li>query 发送到 api.tavily.com 由 Tavily 处理</li>
                <li>本地随时清除；env var <code>TAVILY_API_KEY</code> 启动时优先</li>
              </ul>
              <input
                className="vision-modal-input"
                type="password"
                placeholder={
                  tavilyState?.kind === 'configured'
                    ? '粘贴新 key 覆盖（或留空仅查看）'
                    : '粘贴 tvly-... key'
                }
                value={tavilyKeyDraft}
                onChange={(e) => setTavilyKeyDraft(e.target.value)}
                autoFocus
              />
            </div>
            <div className="vision-modal-actions">
              <button
                type="button"
                className="vision-modal-btn-cancel"
                onClick={handleTavilyModalCancel}
              >
                取消
              </button>
              {tavilyState?.kind === 'configured' && (
                <button
                  type="button"
                  className="vision-modal-btn-cancel"
                  onClick={handleTavilyKeyReset}
                >
                  清除已存 key
                </button>
              )}
              <button
                type="button"
                className="vision-modal-btn-ok"
                onClick={handleTavilyKeySubmit}
                disabled={!tavilyKeyDraft.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingApproval && (
        <div className="vision-modal-overlay">
          <div className="vision-modal approval-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vision-modal-title">⚠️ AI 请求授权</div>
            <div className="vision-modal-body">
              <p className="approval-summary">{pendingApproval.summary}</p>
              {pendingApproval.path && (
                <p className="approval-detail">
                  <b>路径：</b>
                  <code>{pendingApproval.path}</code>
                </p>
              )}
              {pendingApproval.command && (
                <p className="approval-detail">
                  <b>命令：</b>
                  <code>{pendingApproval.command}</code>
                </p>
              )}
              {pendingApproval.contentPreview && (
                <p className="approval-detail">
                  <b>内容预览：</b>
                  <code className="approval-content-preview">
                    {pendingApproval.contentPreview}
                  </code>
                </p>
              )}
              <p className="approval-hint">
                tool: <code>{pendingApproval.tool}</code> · 60s 不操作自动拒绝
              </p>
            </div>
            <div className="approval-actions">
              <button
                type="button"
                className="vision-modal-btn-cancel"
                onClick={() => handleApprovalDecision('deny')}
              >
                拒绝
              </button>
              <button
                type="button"
                className="approval-btn-once"
                onClick={() => handleApprovalDecision('allow-once')}
              >
                允许一次
              </button>
              {pendingApproval.path && (
                <>
                  <button
                    type="button"
                    className="approval-btn-trust-session"
                    onClick={() => handleApprovalDecision('trust-dir-session')}
                  >
                    信任此目录（本会话）
                  </button>
                  <button
                    type="button"
                    className="approval-btn-trust-permanent"
                    onClick={() => handleApprovalDecision('trust-dir-permanent')}
                  >
                    永久信任此目录
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <div ref={petRef} className="pet" data-state={state} onMouseDown={handleMouseDown}>
        {/* 双层 cross-fade：两个 absolute 叠加，opacity 互补 ramp。
            会同时跑 0→1 和 1→0，旧 GIF 在 fade-out 期间继续 paint 旧帧（不会突然透明）。
            onLoad 驱动 swap：新 GIF decode 完才 ramp，消除 Chromium <img src> 重置的 1-2 帧透明窗口。
            两层都常驻 mount，避免 unmount/remount 抖动；通过 frontIdx 切角色。 */}
        <img
          src={urls[0]}
          alt=""
          draggable={false}
          onLoad={handleImgLoad(0)}
          style={{
            opacity: frontIdx === 0 ? 1 : 0,
            transition: `opacity ${FADE_HALF_MS}ms ${FADE_EASING}`
          }}
        />
        <img
          src={urls[1]}
          alt=""
          draggable={false}
          onLoad={handleImgLoad(1)}
          style={{
            opacity: frontIdx === 1 ? 1 : 0,
            transition: `opacity ${FADE_HALF_MS}ms ${FADE_EASING}`
          }}
        />
      </div>
    </div>
  )
}

export default App
