/**
 * 屏幕截取（M4-A-2）—— 用 Electron desktopCapturer 拿当前 cursor 所在 display 的
 * 全屏 PNG bytes，并计算 pet_bbox（桌宠 window 在该屏中的像素位置）。
 *
 * 关键设计：
 *  - **不写盘**：desktopCapturer 返回的 NativeImage 直接 toPNG() 得 Buffer，全程内存
 *  - **cursor-screen heuristic**：多屏场景只截 cursor 所在的那块，避免发整组屏幕
 *  - **pet_bbox**：BrowserWindow.getBounds()（DIP）→ 减 display.bounds 偏移 →
 *    乘 scaleFactor 得物理像素 → 发给 vision-service crop 桌宠区域
 *
 * macOS 注意：首次调用 desktopCapturer 触发系统"屏幕录制权限"弹窗 —— 用户需在
 * 系统设置批准并重启应用。失败时返回 capture-failed 让上层 fail-open。
 */
import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron'

export interface CaptureResult {
  ok: true
  /** PNG bytes，仅在内存中流转，发完即丢 */
  imageBytes: Buffer
  /** 截屏原始尺寸（物理像素） */
  width: number
  height: number
  /** 桌宠 window 在本次截屏中的位置（物理像素），null = 桌宠不在此屏 */
  petBbox: { x: number; y: number; w: number; h: number } | null
}

/** 截屏失败原因 —— M4-A-4 后只剩"截屏失败 + 具体 detail"一种，AI 自己看 detail 引导用户。 */
export interface CaptureFailure {
  ok: false
  error: { kind: 'capture-failed'; detail: string }
}

/** 截屏入口：返回 CaptureResult 或 fail-open 错误。petWindow 用于算 bbox。 */
export async function captureCursorScreen(
  petWindow: BrowserWindow | null
): Promise<CaptureResult | CaptureFailure> {
  try {
    // —— macOS 权限 pre-check ——
    // macOS 13+ 上，没权限时 desktopCapturer.getSources() 不再触发系统请求弹窗，
    // 而是返回空数组或被裁掉桌面内容。所以我们必须显式查 + 主动触发请求。
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      console.warn(`[screen-capture] macOS screen recording status: ${status}`)
      if (status !== 'granted') {
        return {
          ok: false,
          error: {
            kind: 'capture-failed',
            detail:
              `macOS 屏幕录制权限状态: ${status} —— ` +
              `请在「系统设置 → 隐私与安全 → 屏幕录制」勾选 Electron（或把 ` +
              `node_modules/electron/dist/Electron.app 拖进列表），然后完全 ` +
              `quit npm run dev（ctrl-C）并重新启动`
          }
        }
      }
    }

    // 找 cursor 所在 display（多屏场景）
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)

    // desktopCapturer 用物理像素 thumbnailSize 才不会让 NativeImage 被缩放
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    })

    // 用 display_id 精确匹配 source —— types/electron 暴露的 display_id 是字符串
    const source =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) {
      return {
        ok: false,
        error: { kind: 'capture-failed', detail: 'no usable source from desktopCapturer' }
      }
    }

    const thumb = source.thumbnail
    const size = thumb.getSize()
    const imageBytes = thumb.toPNG()

    // —— 算 pet_bbox（桌宠在本屏的物理像素位置） ——
    let petBbox: CaptureResult['petBbox'] = null
    if (petWindow && !petWindow.isDestroyed()) {
      const wb = petWindow.getBounds() // DIP, 全局坐标系
      // 桌宠 window 是否在当前截屏 display 上：用中心点判定（防边界情况）
      const cx = wb.x + wb.width / 2
      const cy = wb.y + wb.height / 2
      const db = display.bounds
      if (cx >= db.x && cx < db.x + db.width && cy >= db.y && cy < db.y + db.height) {
        const sf = display.scaleFactor
        petBbox = {
          x: Math.max(0, Math.round((wb.x - db.x) * sf)),
          y: Math.max(0, Math.round((wb.y - db.y) * sf)),
          w: Math.round(wb.width * sf),
          h: Math.round(wb.height * sf)
        }
      }
    }

    return {
      ok: true,
      imageBytes,
      width: size.width,
      height: size.height,
      petBbox
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[screen-capture] caught exception:', msg, err)
    return { ok: false, error: { kind: 'capture-failed', detail: msg } }
  }
}
