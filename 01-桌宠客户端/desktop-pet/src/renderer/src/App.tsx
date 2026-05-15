/**
 * App — M1（修复 #1 #3 #7；回退 #2 双层 crossfade）。
 *
 * 关键决策：
 *  - 维持单层 SVG + key={state} 强制重挂载（回退本次的双层 crossfade）。
 *  - 双层 crossfade 同时 inline 两份 SVG 会让 SVG 内嵌的全局 class
 *    （eyes-js / body-js / shadow-js / .left-bubble 等）进入主文档 CSSOM，
 *    两层互相污染 → happy 跳跃 keyframes 引用错乱，视觉撕裂。
 *  - 正确做法（M2）：用 iframe srcdoc 或 ShadowDOM 隔离每个 SVG layer，
 *    或加载前给 ID/class 加 unique prefix。M1 阶段先保证视觉正确。
 *  - PetState 从 src/shared/pet-state 单一源 import（修 #7）。
 *  - SVG 通过 ?raw + dangerouslySetInnerHTML 让内嵌 @keyframes 真正播。
 */
import { useEffect, useRef, useState } from 'react'
import type { PetState } from '../../shared/pet-state'
import idleRaw from '@themes/clawd-dev/clawd-idle-follow.svg?raw'
import thinkingRaw from '@themes/clawd-dev/clawd-working-thinking.svg?raw'
import successRaw from '@themes/clawd-dev/clawd-happy.svg?raw'

const DRAG_THRESHOLD_PX = 5

// 状态 → SVG 文本 映射（M1 demo 三态）。
// M1-2 完整主题加载器：从 themes/<active>/theme.json 动态构造这张表。
const SVG_BY_STATE: Partial<Record<PetState, string>> = {
  idle: idleRaw,
  thinking: thinkingRaw,
  success: successRaw
}

function App(): React.JSX.Element {
  const [state, setState] = useState<PetState>('idle')
  const dragRef = useRef<{
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)

  // 订阅主进程状态推送
  useEffect(() => {
    const off = window.api.onPetState((s) => setState(s))
    return off
  }, [])

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // 左键以外不接管；右键留给 M1 之后弹菜单
    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    }
  }

  useEffect(() => {
    const onMove = (ev: MouseEvent): void => {
      const ref = dragRef.current
      if (!ref) return
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
      if (ref && !ref.moved) {
        window.api.petClick()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const svgHtml = SVG_BY_STATE[state] ?? SVG_BY_STATE.idle ?? ''

  return (
    <div className="stage">
      <div
        key={state}
        className="pet"
        data-state={state}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}

export default App
