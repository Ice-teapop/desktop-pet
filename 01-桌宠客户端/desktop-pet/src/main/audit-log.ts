/**
 * Tool 调用审计日志（M4-C）—— 本地 append-only JSONL，每行一条事件。
 *
 * 字段：ts / tool / args_summary / result / approval / detail
 *
 * 性质：
 *  - 仅本地 ~/Library/Application Support/DeskPet/audit.log（chmod 600）
 *  - 不上传任何地方
 *  - 自动滚动：超过 5MB 时 rename .1 备份并新建
 *  - 用户可在文件系统直接删；M5 设置面板会加 "清除日志" 按钮
 *
 * 不留存纪律 vs 审计需求的冲突：
 *  - tool args 可能含敏感内容（read_file 的 path、command 内容）—— 记录但**不**记
 *    actual file content / clipboard content
 *  - args_summary 是被截断的预览字符串
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

const FILE_NAME = 'audit.log'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export function logPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 清空 audit log（保留文件以维持权限），不递归删除滚动备份。 */
export async function clearAuditLog(): Promise<void> {
  try {
    await fs.writeFile(logPath(), '', { mode: 0o600 })
  } catch (err) {
    console.warn('[audit] clear failed:', err)
    throw err
  }
}

export type AuditResult = 'ok' | 'error' | 'denied' | 'auto-trusted' | 'whitelist'

export interface AuditEntry {
  tool: string
  /** 参数摘要 —— 不含敏感本体（不要 dump file content / clipboard text） */
  argsSummary: string
  result: AuditResult
  /** 额外细节：error message / 用户决策 / matched whitelist 等 */
  detail?: string
}

/**
 * 写一条审计记录。失败时仅 console.warn（不要因 audit 失败阻塞 tool）。
 * 滚动检查放在写之前 —— 一次 stat 开销可忽略。
 */
export async function logToolAction(entry: AuditEntry): Promise<void> {
  const path = logPath()
  try {
    await maybeRotate(path)
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...entry
      }) + '\n'
    await fs.appendFile(path, line, { mode: 0o600 })
  } catch (err) {
    console.warn('[audit] write failed:', err)
  }
}

async function maybeRotate(path: string): Promise<void> {
  try {
    const s = await stat(path)
    if (s.size > MAX_SIZE) {
      await fs.rename(path, path + '.1').catch(() => {
        /* 备份失败就直接 truncate */
      })
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}
