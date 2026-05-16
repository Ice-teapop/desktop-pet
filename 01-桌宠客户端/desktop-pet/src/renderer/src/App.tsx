/**
 * App — M2-2（API key 首启迎宾 + 加密存储入口）。
 *
 * 在 M1-8 / M2-1 基础上加：
 *  - keyState 订阅主进程推送（'missing' | 'ready'），是唯一事实来源
 *  - 进入 missing：清对话 + 插一条硬编码迎宾 AI 消息 + 自动 setChatOpen(true)
 *  - missing 状态下 submitChat 分流：text 像 sk-ant- key 走 submitKey；不像就 AI 提示
 *  - missing → ready：追加一条「钥匙存好了」AI 消息（让用户知道状态切换了）
 *  - 主进程在 LLM 401 时会自动 reset key + 推 missing，渲染层自然进入再引导流程
 *
 * 时序状态机 chatPhase 不变（closed/opening/open/closing）；missing 状态下也走同一套
 * 开窗动画 —— 第一次启动用户看到的就是窗口从右下角扩出来 + 迎宾消息淡入。
 */
import { useEffect, useRef, useState } from 'react'
import type { PetState } from '../../shared/pet-state'
import type { ActivityState, ChatError, KeyState } from '../../shared/chat-types'
// idle 池 6 种"无聊时的小动作"，闲态随机切
import idleGif from '@themes/clawd-dev/clawd-idle.gif'
import idleReadingGif from '@themes/clawd-dev/clawd-idle-reading.gif'
import sweepingGif from '@themes/clawd-dev/clawd-sweeping.gif'
import jugglingGif from '@themes/clawd-dev/clawd-juggling.gif'
import buildingGif from '@themes/clawd-dev/clawd-building.gif'
import conductingGif from '@themes/clawd-dev/clawd-conducting.gif'
// activity → GIF 映射：识别到不同活动时桌宠"陪你做同样的事"
import typingGif from '@themes/clawd-dev/clawd-typing.gif'
import debuggerGif from '@themes/clawd-dev/clawd-debugger.gif'
import headphonesGif from '@themes/clawd-dev/clawd-headphones-groove.gif'
// LLM 流状态
import thinkingGif from '@themes/clawd-dev/clawd-thinking.gif'
import happyGif from '@themes/clawd-dev/clawd-happy.gif'
import errorGif from '@themes/clawd-dev/clawd-error.gif'

const DRAG_THRESHOLD_PX = 5

// idle 子调度器：8–15s 随机切下一个变体（不重复上次）
const IDLE_VARIANT_MIN_MS = 8000
const IDLE_VARIANT_MAX_MS = 15000

// idle 6 变体池 —— 默认 idx=0 是 idle (主 idle 形象)
const IDLE_POOL: ReadonlyArray<string> = [
  idleGif,
  idleReadingGif,
  sweepingGif,
  jugglingGif,
  buildingGif,
  conductingGif
]

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

/** 渲染层用的同款前缀校验（main 端有更严的；这里只做明显错误的早拦截）。 */
function looksLikeApiKey(text: string): boolean {
  return /^sk-ant-[\w-]{20,}$/.test(text.trim())
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
  const msgIdRef = useRef(1)
  const prevKeyStateRef = useRef<KeyState | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const convRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const inHitRef = useRef(false)
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

  useEffect(() => {
    const off = window.api.onActivityState((a) => setActivity(a))
    return off
  }, [])

  // idle 子调度器：state=idle && activity=idle 时随机切 6 个 idle 变体
  // 之一（不重复上次）。状态切走会 cleanup timer，不留 ghost。
  useEffect(() => {
    if (state !== 'idle' || activity !== 'idle') return
    const schedule = (): NodeJS.Timeout => {
      const delay =
        IDLE_VARIANT_MIN_MS + Math.random() * (IDLE_VARIANT_MAX_MS - IDLE_VARIANT_MIN_MS)
      return setTimeout(() => {
        setIdleVariantIdx((cur) => {
          let next = Math.floor(Math.random() * IDLE_POOL.length)
          if (next === cur) next = (next + 1) % IDLE_POOL.length
          return next
        })
        timer = schedule()
      }, delay)
    }
    let timer = schedule()
    return () => clearTimeout(timer)
  }, [state, activity])

  // mount 后立刻 ping 主进程要当前 keyState —— 防御启动 race：
  // 主进程 did-finish-load 推 key:state 时若这个 useEffect 还没 subscribe 会丢
  useEffect(() => {
    const off = window.api.onKeyState((s) => setKeyState(s))
    window.api.requestKeyState()
    return off
  }, [])

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
      msgIdRef.current = 1
      setMessages([{ id: msgIdRef.current++, role: 'ai', text, status: 'done' }])
      setChatPhase((p) => {
        if (p === 'closed') {
          window.api.setChatOpen(true)
          return 'opening'
        }
        return p
      })
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
    const hitsRect = (el: HTMLElement | null, ev: MouseEvent): boolean => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return (
        ev.clientX >= r.left &&
        ev.clientX <= r.right &&
        ev.clientY >= r.top &&
        ev.clientY <= r.bottom
      )
    }

    const onMove = (ev: MouseEvent): void => {
      if (dragRef.current) {
        if (!inHitRef.current) {
          inHitRef.current = true
          window.api.setIgnoreMouse(false)
        }
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
        return
      }

      const within =
        hitsRect(petRef.current, ev) || (isConvMounted && hitsRect(convRef.current, ev))
      if (within && !inHitRef.current) {
        inHitRef.current = true
        window.api.setIgnoreMouse(false)
      } else if (!within && inHitRef.current) {
        inHitRef.current = false
        window.api.setIgnoreMouse(true)
      }
    }

    const onUp = (): void => {
      const ref = dragRef.current
      dragRef.current = null
      if (!ref || ref.moved) return
      setChatPhase((p) => {
        if (p === 'closed') {
          window.api.setChatOpen(true)
          return 'opening'
        }
        if (p === 'open') return 'closing'
        return p
      })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isConvMounted])

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
      } else if (text.includes('sk-ant-')) {
        // 像 key 但不完整（前缀对但长度 / 字符不对）—— 也遮罩，避免半截 key 暴露在对话历史里
        setMessages((prev) => [
          ...prev,
          {
            id: msgIdRef.current++,
            role: 'user',
            text: '🔑 (输入像 API key 但格式不完整)',
            status: 'done'
          },
          { id: msgIdRef.current++, role: 'ai', text: NOT_KEY_HINT, status: 'done' }
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { id: msgIdRef.current++, role: 'user', text, status: 'done' },
          { id: msgIdRef.current++, role: 'ai', text: NOT_KEY_HINT, status: 'done' }
        ])
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

  // GIF 选择优先级：
  //   LLM 流状态 (thinking / success / error) > 活动识别 (coding 等) > idle 变体池
  // state 反映 LLM 是否在跑，activity 反映用户当下在干啥；LLM 流在跑时不被 activity 抢
  let gifUrl: string
  if (state === 'thinking') {
    gifUrl = thinkingGif
  } else if (state === 'success') {
    gifUrl = happyGif
  } else if (state === 'error') {
    gifUrl = errorGif
  } else if (activity !== 'idle') {
    gifUrl = ACTIVITY_GIF[activity]
  } else {
    gifUrl = IDLE_POOL[idleVariantIdx] ?? IDLE_POOL[0]
  }
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
      <div ref={petRef} className="pet" data-state={state} onMouseDown={handleMouseDown}>
        {/* 不加 key —— 让 React 复用同一 <img> DOM 节点，切 src 由 Chromium 直接换帧。
            带 key={gifUrl} 会 unmount/remount 出现 1 帧透明闪烁；Chromium 设新 src
            本来就重新解码 + 从第一帧播，不需要 React 重 mount。 */}
        <img src={gifUrl} alt="" draggable={false} />
      </div>
    </div>
  )
}

export default App
