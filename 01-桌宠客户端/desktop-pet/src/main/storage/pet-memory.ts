/**
 * 桌宠跨会话长期记忆（M5-2）—— chmod 600 plain markdown。
 *
 * 设计：单文件 append-only markdown，每条记忆一行（带 ISO timestamp 前缀），
 * AI 通过 `remember` tool 写入。启动时整个加载进 system prompt，让 AI 看到
 * 之前记下来的事实/偏好/称呼。
 *
 * 边界（防膨胀）：
 *  - MEMORY_MAX_BYTES = 16KB —— 超过截断最老的（前面 N 行），保留最新
 *  - MEMORY_LINE_MAX = 500 chars —— 单条记忆不许太长
 *  - 不加密 —— 用户能手动编辑/查看（plain markdown 更友好）
 *
 * 用户可在设置面板「在 Finder 显示」/「清空」/直接编辑文件。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const FILE_NAME = 'pet-memory.md'
const MEMORY_MAX_BYTES = 16 * 1024
export const MEMORY_LINE_MAX = 500

function memoryPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 读完整 memory —— 找不到返回空字符串。注入 system prompt 用。 */
export async function loadMemory(): Promise<string> {
  try {
    return await fs.readFile(memoryPath(), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn('[pet-memory] read failed:', err)
    return ''
  }
}

/**
 * 追加一条记忆。AI 通过 remember tool 调用 → main exec → 这里。
 * 自动加 timestamp 前缀；超长截断；文件总大小超限时丢最老的。
 */
export async function appendMemory(note: string): Promise<void> {
  const trimmed = note.trim().replace(/\n+/g, ' ').slice(0, MEMORY_LINE_MAX)
  if (!trimmed) return
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const line = `- [${ts}] ${trimmed}\n`

  let existing = ''
  try {
    existing = await fs.readFile(memoryPath(), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[pet-memory] append read failed:', err)
    }
  }
  let combined = existing + line
  // 超出上限：保留尾部 MEMORY_MAX_BYTES（最新的）
  if (Buffer.byteLength(combined, 'utf8') > MEMORY_MAX_BYTES) {
    while (Buffer.byteLength(combined, 'utf8') > MEMORY_MAX_BYTES) {
      const nl = combined.indexOf('\n')
      if (nl < 0) break
      combined = combined.slice(nl + 1)
    }
  }
  try {
    await fs.writeFile(memoryPath(), combined, { mode: 0o600 })
  } catch (err) {
    console.warn('[pet-memory] write failed:', err)
    throw err
  }
}

/**
 * 整段覆盖写 pet-memory.md（设置面板里 user 直接编辑用）。
 * 不强加 timestamp 也不 trim 行 —— user 完全主权。
 * 上限 100KB 兜底（防误传超大内容）。
 */
export async function setMemory(content: string): Promise<void> {
  const MAX_BYTES = 100 * 1024
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw new Error(`memory content too large (>${MAX_BYTES} bytes)`)
  }
  await fs.writeFile(memoryPath(), content, { mode: 0o600 })
}

export async function clearMemory(): Promise<void> {
  try {
    await fs.unlink(memoryPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

export function petMemoryPath(): string {
  return memoryPath()
}
