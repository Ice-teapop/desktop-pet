/**
 * App — M1 demo：状态机驱动的小螃蟹。
 *
 * 关键改动 vs M0.5：
 *  - SVG 通过 ?raw import 拿到字符串 + dangerouslySetInnerHTML 注入 DOM。
 *    这样 SVG 内嵌的 <style>@keyframes 会进主文档 CSSOM，动画就播了
 *    （而非 <img> 沙箱化加载时被废）。
 *  - useEffect 订阅主进程 'pet:state' → 切换显示的 SVG。
 *  - 单击发 'pet:event:click' → 主进程触发 demo 状态循环
 *    (idle → thinking 2s → success 1.5s → idle)。
 *  - 距离阈值 5px 区分单击 vs 拖动保留不变。
 *
 * 注意：clawd 素材通过 @themes alias 拉，物理文件 .gitignore 不入库（AGPL 隔离）。
 * 同时只挂一个 SVG → SVG 内 id 不冲突，OK。
 */
import { useEffect, useRef, useState } from 'react'
import type { PetState } from '../../preload/index.d'
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
        // 没拖动 = 点击 → 通知主进程跑 demo cycle
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
        // key 跟着 state 变化 —— React 重挂载该 div，SVG 内嵌动画从头开始
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
