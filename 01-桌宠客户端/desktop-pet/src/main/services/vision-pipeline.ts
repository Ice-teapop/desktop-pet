/**
 * Vision 流水线编排（M4-A-2）—— 串 capture → vision-client → format OCR summary。
 *
 * 调用方：main 的 chat:submit handler 在 vision toggle 开时调用，把返回的
 * summary prefix 到 user message。
 *
 * 进度推送：每个 stage 通过传入的 onProgress 回调通知渲染层显示 3-stage 文字。
 * 错误处理：每一步失败都映射成 VisionFailReason，由上层决定 fail-open（默认）
 * 还是 fail-closed。pipeline 本身不抛异常。
 *
 * 不留存纪律：
 *  - imageBytes 是局部 Buffer，函数退出即垃圾回收
 *  - 不写 console.log(bytes)、不写文件、不传给其它模块
 *  - OCR 结果是 string，作为返回值消费一次后不再持有
 */
import type { BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import type {
  VisionFailReason,
  VisionProgress,
  VisionResult
} from '../../shared/vision-types'
import { captureCursorScreen } from './screen-capture'
import { extract, type ExtractMetadata, type Block } from './vision-client'

export interface RunVisionParams {
  token: string
  petWindow: BrowserWindow | null
  /** 渲染层显示 3-stage progress 用 —— 主进程→渲推送 */
  onProgress: (p: VisionProgress) => void
}

/** 单次 vision turn 的 frame_seq —— 进程内递增，仅用于服务端日志关联 */
let frameSeq = 0

/**
 * 把 vision-service 返回的 blocks 折成 AI 可读的纯文本摘要。
 *
 * 格式：每个 block 一行，type 前缀 + raw_text/encoded。code 块加 ``` 围栏；
 * formula 块给 LaTeX；table 给 markdown-style 简表。低质量的 block（unknown /
 * 空 raw_text）跳过。
 *
 * 目标：让 AI 一眼看清屏幕主要内容，不堆冗长 metadata。
 */
function formatBlocks(blocks: Block[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    if (b.type === 'unknown') continue
    const text = b.raw_text.trim()
    switch (b.type) {
      case 'code': {
        const lang =
          typeof b.encoded === 'object' && b.encoded && 'lang' in b.encoded
            ? String((b.encoded as { lang: unknown }).lang)
            : ''
        const codeText =
          typeof b.encoded === 'object' && b.encoded && 'text' in b.encoded
            ? String((b.encoded as { text: unknown }).text)
            : text
        if (codeText) lines.push(`\`\`\`${lang}\n${codeText}\n\`\`\``)
        break
      }
      case 'formula': {
        const latex = typeof b.encoded === 'string' ? b.encoded : text
        if (latex) lines.push(`$${latex}$`)
        break
      }
      case 'table': {
        if (
          typeof b.encoded === 'object' &&
          b.encoded &&
          'headers' in b.encoded &&
          'rows' in b.encoded
        ) {
          const obj = b.encoded as { headers: unknown[]; rows: unknown[][] }
          const headers = obj.headers.map(String).join(' | ')
          const sep = obj.headers.map(() => '---').join(' | ')
          const rows = obj.rows.map((r) => r.map(String).join(' | ')).join('\n')
          if (headers) lines.push(`${headers}\n${sep}\n${rows}`)
        } else if (text) {
          lines.push(text)
        }
        break
      }
      default:
        if (text) lines.push(text)
    }
  }
  return lines.join('\n').trim()
}

/** content_hash 给服务端做幂等 / 去重日志（不存图片本身，仅 16 字节摘要） */
function shortHash(bytes: Buffer): string {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export async function runVisionPipeline(params: RunVisionParams): Promise<VisionResult> {
  const { token, petWindow, onProgress } = params

  if (!token) {
    const err: VisionFailReason = { kind: 'no-token' }
    onProgress({ stage: 'failed', reason: err })
    return { ok: false, error: err }
  }

  // —— Stage 1: 截屏 ——
  onProgress({ stage: 'capturing' })
  const cap = await captureCursorScreen(petWindow)
  if (!cap.ok) {
    onProgress({ stage: 'failed', reason: cap.error })
    return { ok: false, error: cap.error }
  }

  // —— Stage 2: 调 vision-service ——
  onProgress({ stage: 'recognizing' })
  const metadata: ExtractMetadata = {
    region_id: 'screen',
    frame_seq: ++frameSeq,
    captured_at: new Date().toISOString(),
    region_size: { w: cap.width, h: cap.height },
    content_hash: shortHash(cap.imageBytes),
    ...(cap.petBbox ? { pet_bbox: cap.petBbox } : {}),
    options: {
      include_reading_text: false, // 取自己 format 的 summary，不要服务端拼好的 reading_text
      include_chart_crop: false,
      max_blocks: 80
    }
  }

  const result = await extract({
    token,
    imageBytes: cap.imageBytes,
    metadata
  })

  // 不留存纪律：截屏 bytes 不再被任何后续代码引用，让 GC 立即回收
  ;(cap as { imageBytes?: Buffer }).imageBytes = undefined

  if (!result.ok) {
    onProgress({ stage: 'failed', reason: result.error })
    return { ok: false, error: result.error }
  }

  // —— Stage 3: format ——
  const summary = formatBlocks(result.data.blocks)
  if (!summary) {
    // 空 OCR：不算失败，但提示用户没识别到内容
    const empty: VisionResult = { ok: true, summary: '（屏幕上未识别到文本）', ocrChars: 0 }
    onProgress({ stage: 'attached', ocrChars: 0 })
    return empty
  }
  onProgress({ stage: 'attached', ocrChars: summary.length })
  return { ok: true, summary, ocrChars: summary.length }
}
