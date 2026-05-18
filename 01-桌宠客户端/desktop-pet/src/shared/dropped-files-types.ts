/**
 * v0.4.0 改动 2 [D] 拖文件处理结果 — main / preload / renderer 三端共用类型.
 *
 * accepted: 通过安全检查可读, 文本类 preview 是前 2KB UTF-8, 二进制 null
 * rejected: 拒绝原因人类可读 (路径黑名单 / 太大 / 扩展名不在白名单 / 不存在)
 * summary: 给 AI 看的中文 summary, renderer 直接走 chat:submit 走正常 stream
 */

export interface AcceptedDroppedFile {
  path: string
  name: string
  ext: string
  size: number
  preview: string | null
}

export interface RejectedDroppedFile {
  path: string
  reason: string
}

export interface DropResult {
  accepted: AcceptedDroppedFile[]
  rejected: RejectedDroppedFile[]
  summary: string
}
