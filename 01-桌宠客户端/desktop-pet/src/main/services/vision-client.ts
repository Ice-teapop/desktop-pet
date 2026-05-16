/**
 * vision-service HTTPS 客户端（M4-A-2）——
 * 调《视觉服务接口契约 API v1》的 raw-bytes 模式 POST /v1/extract。
 *
 * 协议（与 server src/api/routes.py 对齐）：
 *  - body: PNG raw bytes（不走 multipart，避免服务器 spool 到磁盘）
 *  - header X-DeskPet-Meta: base64(JSON) 的 ExtractMetadata
 *  - Authorization: Bearer <token>
 *  - X-DeskPet-Client: 必填，便于服务端日志关联（不含 IP）
 *  - X-Request-Id: 客户端生成的 short id 便于 cross-log debug
 *
 * 错误统一映射成 VisionFailReason，让 pipeline 层做 fail-open。
 * Node 18+ 原生 fetch + AbortController 超时，零额外依赖。
 */
import { randomBytes } from 'crypto'
import type { VisionFailReason } from '../../shared/vision-types'

const ENDPOINT = 'https://vision.iceteamk.com/v1/extract'
const CLIENT_ID = 'deskpet-electron/0.1'

export interface ExtractMetadata {
  region_id: string
  frame_seq: number
  captured_at: string
  region_size: { w: number; h: number }
  content_hash: string
  pet_bbox?: { x: number; y: number; w: number; h: number }
  options?: {
    include_reading_text?: boolean
    include_chart_crop?: boolean
    max_blocks?: number
  }
}

/** 与服务端 contract.py 的 Block 对齐（只声明客户端用得到的字段） */
export interface Block {
  id: string
  type: 'text' | 'heading' | 'table' | 'formula' | 'code' | 'symbol' | 'error' | 'chart' | 'unknown'
  order: number
  bbox: [number, number, number, number]
  encoded: unknown
  raw_text: string
  notes?: string | null
}

export interface ExtractResponse {
  ok: true
  request_id: string
  region_id: string
  frame_seq: number
  blocks: Block[]
  reading_text: string
  meta: { latency_ms: number; pipeline_version: string; recognizers_used: string[] }
}

export type ExtractResult =
  | { ok: true; data: ExtractResponse }
  | { ok: false; error: VisionFailReason }

export interface ExtractParams {
  token: string
  imageBytes: Buffer
  metadata: ExtractMetadata
  /** 总超时（ms）—— 网络 + 服务端处理；超过即 abort */
  timeoutMs?: number
}

/** 短随机 request id 便于日志关联（8 字节 hex = 16 字符） */
export function newRequestId(): string {
  return `req_${randomBytes(8).toString('hex')}`
}

export async function extract(params: ExtractParams): Promise<ExtractResult> {
  const { token, imageBytes, metadata, timeoutMs = 12000 } = params
  const metaJson = JSON.stringify(metadata)
  const metaB64 = Buffer.from(metaJson, 'utf8').toString('base64')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-DeskPet-Client': CLIENT_ID,
        'X-DeskPet-Meta': metaB64,
        'X-Request-Id': newRequestId(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(imageBytes.byteLength)
      },
      // fetch 的 BodyInit 类型在 lib.dom + @types/node 重叠区严格 reject
      // Buffer / Uint8Array（SharedArrayBuffer-aware 类型分支问题）。
      // 拷贝出独立 ArrayBuffer 再走 Blob，runtime 一次浅 copy 不影响 8MB 上限性能。
      body: new Blob(
        [
          imageBytes.buffer.slice(
            imageBytes.byteOffset,
            imageBytes.byteOffset + imageBytes.byteLength
          ) as ArrayBuffer
        ],
        { type: 'application/octet-stream' }
      ),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout' } }
    }
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { kind: 'network', detail } }
  } finally {
    clearTimeout(timer)
  }

  if (resp.status === 401) {
    return { ok: false, error: { kind: 'unauthorized' } }
  }
  if (resp.status === 429) {
    const retry = resp.headers.get('retry-after')
    const retryAfterSec = retry ? Number(retry) : undefined
    return { ok: false, error: { kind: 'rate-limited', retryAfterSec } }
  }
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`
    try {
      const body = (await resp.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      /* body 不是 JSON，保持默认 message */
    }
    return { ok: false, error: { kind: 'server-error', status: resp.status, message } }
  }

  try {
    const data = (await resp.json()) as ExtractResponse
    return { ok: true, data }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { kind: 'network', detail: `bad json: ${detail}` } }
  }
}

/** 探活 /v1/health —— 用于设置流程中"测一下 token + 连通性" */
export async function healthCheck(token: string, timeoutMs = 5000): Promise<ExtractResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // health 不需要 token，但带上让服务端记一次客户端探活
    const resp = await fetch('https://vision.iceteamk.com/v1/health', {
      headers: { 'X-DeskPet-Client': CLIENT_ID },
      signal: controller.signal
    })
    if (!resp.ok) {
      return {
        ok: false,
        error: { kind: 'server-error', status: resp.status, message: `health HTTP ${resp.status}` }
      }
    }
    // 顺便验 token 真的能过：调一次 capabilities（要 auth）
    const capResp = await fetch('https://vision.iceteamk.com/v1/capabilities', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-DeskPet-Client': CLIENT_ID
      },
      signal: controller.signal
    })
    if (capResp.status === 401) {
      return { ok: false, error: { kind: 'unauthorized' } }
    }
    if (!capResp.ok) {
      return {
        ok: false,
        error: {
          kind: 'server-error',
          status: capResp.status,
          message: `capabilities HTTP ${capResp.status}`
        }
      }
    }
    // healthCheck 拿不到 ExtractResponse —— 借类型壳子返回 ok=true 即可
    return { ok: true, data: {} as ExtractResponse }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout' } }
    }
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { kind: 'network', detail } }
  } finally {
    clearTimeout(timer)
  }
}
