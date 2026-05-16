/**
 * Vision 模块 IPC + 内部类型定义（M4-A-2）。
 *
 * 跨 main / preload / renderer 三层共享。所有 vision 相关消息走这里定义的
 * discriminated union，避免运行时字符串比较。
 */

/** vision 配置状态（主→渲推送 + 渲拉取） */
export type VisionState =
  | { kind: 'disabled-no-token' } // 用户没设过 token，不可启用
  | { kind: 'disabled' } // token 已设但 toggle 关
  | { kind: 'enabled' } // toggle 开，每次发消息会截屏

/** 3-stage progress：渲染层据此显示文字 + 状态机 */
export type VisionProgress =
  | { stage: 'capturing' } // "📸 截图中..."
  | { stage: 'recognizing' } // "🔍 识别中..."
  | { stage: 'attached'; ocrChars: number } // "✓ 已附加 OCR（84 字）"
  | { stage: 'failed'; reason: VisionFailReason } // inline warning + fail-open

/** 失败原因 discriminated union —— UI 据此显示对应错误文案 */
export type VisionFailReason =
  | { kind: 'no-token' }
  | { kind: 'capture-failed'; detail: string } // desktopCapturer 失败
  | { kind: 'network'; detail: string } // fetch 失败 / TLS / DNS
  | { kind: 'unauthorized' } // 401 token 错
  | { kind: 'rate-limited'; retryAfterSec?: number }
  | { kind: 'server-error'; status: number; message: string }
  | { kind: 'timeout' } // 超过 totalTimeoutMs

/** 截屏后 OCR 提取结果（main 内部，不出 IPC 边界） */
export interface VisionExtractResult {
  ok: true
  /** 拼好的可读 OCR 摘要文本，直接 prefix 进 user message */
  summary: string
  /** 字符数 —— 给 UI progress 显示 */
  ocrChars: number
}

export type VisionResult = VisionExtractResult | { ok: false; error: VisionFailReason }
