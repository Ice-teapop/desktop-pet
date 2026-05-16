/**
 * Vision capture adapter（M4-A-3 agentic）—— 把 screen-capture 的结果适配成
 * anthropic.ts 期望的 ScreenCaptureResult 形状，给 LLM tool_use 路径直接用。
 *
 * 设计变化（vs 上一版手动 always-on）:
 *  - 不再走 onProgress 回调（无感纪律：UI 不显示 chip）
 *  - 不再有 runVisionPipeline 这种 orchestrator —— AI 通过 view_screen tool 调用
 *  - 仅一个工具函数：截屏 + base64 → tool_result 内容
 *
 * 不留存纪律：imageBytes 在本函数返回后即可被 GC（base64 string 也只在
 * Anthropic SDK request body 里短暂活到 HTTPS send 完）。
 */
import type { BrowserWindow } from 'electron'
import { captureCursorScreen } from './screen-capture'

/** 截屏结果 —— 给 tool 路由用的简化形状（不含 width/height，AI 不需要）。 */
export type ScreenCaptureResult =
  | {
      ok: true
      data: string // base64
      mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    }
  | { ok: false; error: string }

/**
 * 给 LLM tool loop 用的截屏入口：返回 ScreenCaptureResult 直接喂回
 * anthropic.stream(captureScreen)。失败时返回 ok:false + 人类可读 error message
 * 让 AI 自然告诉用户原因（system prompt 里已说明引导用户去开权限）。
 */
export async function captureForTool(
  petWindow: BrowserWindow | null
): Promise<ScreenCaptureResult> {
  const cap = await captureCursorScreen(petWindow)
  if (!cap.ok) {
    return { ok: false, error: cap.error.detail }
  }
  const data = cap.imageBytes.toString('base64')
  return {
    ok: true,
    data,
    mediaType: 'image/png'
  }
}
