/**
 * App — M1（含 M1-7 点击穿透 hit testing）。
 *
 * 行为：
 *  - 主进程默认 setIgnoreMouseEvents(true, {forward:true})：透明区域 click
 *    穿透到底层 app；但 mousemove 仍 forward 到渲染层做 hit testing
 *  - 鼠标进入 .pet rect → IPC setIgnoreMouse(false)：本窗口接收 click 拖动
 *  - 鼠标离开 .pet rect → IPC setIgnoreMouse(true)：恢复穿透
 *  - 拖动期间（dragRef.current 非空）强制不穿透，鼠标快速滑出 rect 也能继续拖
 *
 * 当前 hit zone = .pet 的 boundingRect（220×220 矩形）。M2 升级为像素级
 * hit testing（按 SVG 实体像素精确判定）。
 *
 * 注意：clawd 素材通过 @themes alias，文件 .gitignore 不入库（AGPL 隔离）。
 * 双层 crossfade 留到 M2 用 ShadowDOM 隔离后再做。
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

function App(): React.JSX.Element {
  const [state, setState] = useState<PetState>('idle')
  const petRef = useRef<HTMLDivElement | null>(null)
  const inHitRef = useRef(false)
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
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    }
  }

  // 拖动状态机 + hit testing（共用 mousemove/mouseup 监听）
  useEffect(() => {
    const onMove = (ev: MouseEvent): void => {
      // —— 拖动期：强制不穿透；快滑出 rect 也能继续拖 ——
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

      // —— 非拖动：检测鼠标是否在 .pet 实体 rect 内，跨边界时 IPC 切换穿透 ——
      const el = petRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const within =
        ev.clientX >= r.left &&
        ev.clientX <= r.right &&
        ev.clientY >= r.top &&
        ev.clientY <= r.bottom
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
