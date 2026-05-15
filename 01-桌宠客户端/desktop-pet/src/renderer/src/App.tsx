/**
 * App — M1-8（像素风对话框，参考 Pixel Chat 02 - Coral 变体）。
 *
 * 视觉改造：
 *  - 奶油底 + 珊瑚像素边 + 4px 切角，呼应桌宠像素风
 *  - Cubic11 中文像素字体 + Press Start 2P 英文做点缀（kbd 按键）
 *  - typing indicator（三点跳动）替代单纯的状态机 thinking 表示「AI 在打字」
 *  - 提示气泡 hint with kbd 装饰键盘按键
 *  - 紧凑：对话区宽度 280 → 230，窗口 540 → 500，字号 13 → 12 / 12.5
 *
 * 时序状态机 chatPhase 不变：closed / opening / open / closing
 *  - opening 期间不渲染 conversation（等窗口扩好）
 *  - closing 触发 fade-out，onAnimationEnd 完成后回 closed + IPC 缩窗口
 *  - onAnimationEnd 校验 e.animationName === 'conv-fade-out' 避开内嵌动画冒泡
 *
 * IME 防误触发：Enter 提交时检查 isComposing，避免中文输入法 confirm 时误提交。
 */
import { useEffect, useRef, useState } from 'react'
import type { PetState } from '../../shared/pet-state'
import idleRaw from '@themes/clawd-dev/clawd-idle-follow.svg?raw'
import thinkingRaw from '@themes/clawd-dev/clawd-working-thinking.svg?raw'
import successRaw from '@themes/clawd-dev/clawd-happy.svg?raw'

const DRAG_THRESHOLD_PX = 5

const SVG_BY_STATE: Partial<Record<PetState, string>> = {
  idle: idleRaw,
  thinking: thinkingRaw,
  success: successRaw
}

interface ChatMessage {
  id: number
  role: 'user' | 'ai'
  text: string
}

type ChatPhase = 'closed' | 'opening' | 'open' | 'closing'

function App(): React.JSX.Element {
  const [state, setState] = useState<PetState>('idle')
  const [chatPhase, setChatPhase] = useState<ChatPhase>('closed')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const msgIdRef = useRef(1)
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
  // 等 AI 回复：上一条消息是 user，下一条 AI 还没来 → 显示 typing
  const isWaitingForReply =
    messages.length > 0 && messages[messages.length - 1].role === 'user'

  useEffect(() => {
    const off = window.api.onPetState((s) => setState(s))
    return off
  }, [])

  useEffect(() => {
    const off = window.api.onChatReply((text) => {
      setMessages((prev) => [...prev, { id: msgIdRef.current++, role: 'ai', text }])
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

  const submitChat = (): void => {
    const text = draft.trim()
    if (!text) return
    setMessages((prev) => [...prev, { id: msgIdRef.current++, role: 'user', text }])
    window.api.submitChat(text)
    setDraft('')
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // 中文输入法 confirm 时 Enter 也会触发；用 isComposing 跳过
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submitChat()
    }
  }

  const svgHtml = SVG_BY_STATE[state] ?? SVG_BY_STATE.idle ?? ''

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
                    <div className="msg-bubble">{m.text}</div>
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
            placeholder="对桌宠说点啥..."
          />
        </div>
      )}
      <div
        key={state}
        ref={petRef}
        className="pet"
        data-state={state}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}

export default App
