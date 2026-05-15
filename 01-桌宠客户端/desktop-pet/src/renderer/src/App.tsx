/**
 * App — M0.5 显示小螃蟹 + 距离阈值的「点 vs 拖」状态机。
 *
 * 鼠标行为：
 *   - 左键按下并移动 ≥ DRAG_THRESHOLD_PX：进入拖动模式，IPC 发 dx/dy 给主进程
 *   - 左键按下移动 < DRAG_THRESHOLD_PX 即抬起：判定为点击，触发抖一下 + console
 *
 * 当前用 <img> 静态显示 SVG，SVG 内嵌动画不会播 —— M1 改 inline SVG 让 keyframes 工作。
 * 拖动用 IPC + setPosition；M1 看是否升级为 Pointer Capture / 双窗口拖动。
 *
 * 注意：clawd 素材通过 @themes alias，物理文件在 themes/clawd-dev/ 已 gitignore（AGPL 隔离）。
 */
import { useEffect, useRef, useState } from 'react'
import idleSvg from '@themes/clawd-dev/clawd-idle-follow.svg'

const DRAG_THRESHOLD_PX = 5

function App(): React.JSX.Element {
  // bumpKey 每次点击 +1，给 .pet 加 key 强制重挂载 → CSS animation 重启
  const [bumpKey, setBumpKey] = useState(0)
  const dragRef = useRef<{
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // 只响应左键；右键留给 M1 弹菜单
    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    }
  }

  // 在 window 上挂 mousemove/mouseup —— mousedown 在 .pet 上触发后，
  // 即使鼠标快速滑出 .pet 边界也能继续跟踪（mousemove 始终触发）。
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
        // 没拖动 = 点击
        setBumpKey((n) => n + 1)
        console.log('[DeskPet] 单击 — 抖一下')
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="stage">
      <img
        key={bumpKey}
        className="pet"
        src={idleSvg}
        alt="Clawd (dev theme idle)"
        draggable={false}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}

export default App
