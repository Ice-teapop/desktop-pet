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
  /** 编码后的图像 bytes (JPEG / 极小屏可能 PNG)，仅在内存中流转，发完即丢 */
  imageBytes: Buffer
  /** 实际编码 mediaType — 跟 imageBytes 配套, 给上层喂 Anthropic image source */
  mediaType: 'image/jpeg' | 'image/png'
  /** 编码后图像尺寸（物理像素, resize 后） */
  width: number
  height: number
  /** 桌宠 window 在本次截屏中的位置（物理像素, 缩放后），null = 桌宠不在此屏 */
  petBbox: { x: number; y: number; w: number; h: number } | null
}

/**
 * Anthropic 单图 base64 硬限 5MB (5,242,880 bytes). base64 ≈ raw × 4/3, 所以原始
 * bytes 要 ≤ ~3.93MB. 加 margin 用 3.5MB. Retina 4K 屏 PNG 经常 4-6MB, JPEG q85
 * 经过 1920px 长边 cap 后通常 200-600KB.
 *
 * Claude vision 内部 resize 到 1568px, 我们 cap 1920px 留余裕给文字识别清晰度.
 */
const SCREENSHOT_MAX_DIM = 1920
const SCREENSHOT_JPEG_QUALITY = 85
const SCREENSHOT_RAW_LIMIT = 3_500_000 // base64 ~4.65MB, 留 350KB margin 给 5MB

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

    let nativeImg = source.thumbnail
    const origSize = nativeImg.getSize()

    // —— 长边 cap 到 1920px (保留比例) ——
    // 原因: Anthropic vision 内部 resize 到 1568px, 我们保留余裕给文字识别清晰度.
    //       Retina 4K 屏 (3456×2234) 直接 PNG 5+MB, 缩到 1920 长边后 base64 在限内.
    const maxDim = Math.max(origSize.width, origSize.height)
    let outSize = origSize
    let resizeRatio = 1
    if (maxDim > SCREENSHOT_MAX_DIM) {
      resizeRatio = SCREENSHOT_MAX_DIM / maxDim
      outSize = {
        width: Math.round(origSize.width * resizeRatio),
        height: Math.round(origSize.height * resizeRatio)
      }
      nativeImg = nativeImg.resize({
        width: outSize.width,
        height: outSize.height,
        quality: 'good'
      })
    }

    // —— JPEG 编码 + size-guard 降质 fallback ——
    // 文字截屏 q85 足够认字 + 比 PNG 小 5-10x. 仍超 limit (极大屏 + 复杂图)
    // 时按 q10 降到 q40 保底.
    let q = SCREENSHOT_JPEG_QUALITY
    let imageBytes = nativeImg.toJPEG(q)
    while (imageBytes.byteLength > SCREENSHOT_RAW_LIMIT && q > 40) {
      q -= 10
      imageBytes = nativeImg.toJPEG(q)
    }
    if (imageBytes.byteLength > SCREENSHOT_RAW_LIMIT) {
      console.warn(
        `[screen-capture] 编码后仍 ${(imageBytes.byteLength / 1024).toFixed(0)}KB ` +
          `> ${(SCREENSHOT_RAW_LIMIT / 1024).toFixed(0)}KB cap (q=${q}), 仍发出 — 可能 Anthropic 拒收`
      )
    }

    // —— 算 pet_bbox（桌宠在本屏的物理像素位置, 注意 resize 后要乘 resizeRatio） ——
    let petBbox: CaptureResult['petBbox'] = null
    if (petWindow && !petWindow.isDestroyed()) {
      const wb = petWindow.getBounds() // DIP, 全局坐标系
      const cx = wb.x + wb.width / 2
      const cy = wb.y + wb.height / 2
      const db = display.bounds
      if (cx >= db.x && cx < db.x + db.width && cy >= db.y && cy < db.y + db.height) {
        const sf = display.scaleFactor * resizeRatio
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
      mediaType: 'image/jpeg',
      width: outSize.width,
      height: outSize.height,
      petBbox
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[screen-capture] caught exception:', msg, err)
    return { ok: false, error: { kind: 'capture-failed', detail: msg } }
  }
}
