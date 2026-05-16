/**
 * 对话历史持久化（M5-2）—— chmod 600 plain JSON。
 *
 * 不加密 —— 跟 audit log 同样的"本地审计/历史"档次。用户可在 Finder 看自己
 * 的对话历史 + 设置面板可清除。userData 目录已经在用户 home 下，OS 用户权限
 * 隔离够用。
 *
 * 大小：单文件，按 MAX_HISTORY_PAIRS=10 trim 后通常 < 30KB。每次 onDone 后
 * 由 main 进程 debounce 落盘（500ms 合并连续写入）。
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ChatMessage } from '../../shared/chat-types'

const FILE_NAME = 'chat-history.json'

function historyPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 读：找不到 / 解析失败 / 校验失败 → 空数组（让 app 起得来）。 */
export async function loadChatHistory(): Promise<ChatMessage[]> {
  try {
    const raw = await fs.readFile(historyPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const valid: ChatMessage[] = []
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as ChatMessage).role === 'string' &&
        typeof (item as ChatMessage).content === 'string' &&
        ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant')
      ) {
        valid.push({
          role: (item as ChatMessage).role,
          content: (item as ChatMessage).content
        })
      }
    }
    return valid
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[chat-history] load failed, starting empty:', err)
    }
    return []
  }
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  try {
    const data = JSON.stringify(messages, null, 2)
    await fs.writeFile(historyPath(), data, { mode: 0o600 })
  } catch (err) {
    console.warn('[chat-history] save failed:', err)
  }
}

export async function clearChatHistory(): Promise<void> {
  try {
    await fs.unlink(historyPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

export function chatHistoryPath(): string {
  return historyPath()
}
