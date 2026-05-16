/**
 * Tool 池 + 通用 executor（M4-B agentic）—— 集中管理 AI 可调的本地工具。
 *
 * 设计：
 *  - Tool 定义跟具体 LLM 解耦（anthropic / openai / mcp 都能复用 schema）
 *  - executeTool 是 main 端的统一 dispatcher：根据 name 路由到具体实现
 *  - 返回 ToolResult 让 anthropic.ts 拼成 Anthropic 风格的 tool_result block
 *  - 错误以人类可读 string 返回 + is_error:true，让 AI 在回答中自然引导用户处理
 *
 * 不留存纪律：
 *  - view_screen 截屏 bytes 仅在 base64 string 内存活到 SDK send 完
 *  - read_clipboard 内容 main 端不日志、不持久化，只回 AI
 *  - 所有 tool 调用不写盘（除非 future take_note 之类显式 write）
 */
import { BrowserWindow, clipboard, shell } from 'electron'
import type { ActivityState } from '../../shared/chat-types'
import { captureForTool } from '../services/vision-pipeline'

/** LLM-agnostic Tool 定义 —— 用 JSON Schema input_schema 兼容 Anthropic / OpenAI / MCP */
export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  }
}

/**
 * Tool 执行结果。content 可以是 string（普通文本回 AI）或 ToolContentBlock[]
 * （含 image 的复合 —— 仅 view_screen 用）。
 */
export type ToolResultContent = string | ToolContentBlock[]

export type ToolContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
        data: string
      }
    }

export type ToolResult =
  | { ok: true; content: ToolResultContent }
  | { ok: false; error: string }

/** main 端给 executeTool 注入的上下文（依赖项） */
export interface ToolContext {
  petWindow: BrowserWindow | null
  /** 当前活动识别状态（由 detector 推出） —— 用于 current_app_info */
  currentActivity: ActivityState
  /** 当前前台 app 名（active-app detector 维护，可能空字符串） */
  currentAppName: string
  currentAppBundleId: string
}

// ============================================================================
// Tool 定义池
// ============================================================================

export const VIEW_SCREEN: ToolDef = {
  name: 'view_screen',
  description:
    "Capture the user's current screen as a PNG image. " +
    "ONLY call when the user's question explicitly references " +
    'their screen, a visible window, displayed content, or a UI element ' +
    'they can see. DO NOT call for general questions, math, jokes, or topics ' +
    'unrelated to what is currently on their screen.',
  input_schema: { type: 'object', properties: {}, required: [] }
}

export const READ_CLIPBOARD: ToolDef = {
  name: 'read_clipboard',
  description:
    "Read the user's macOS clipboard text content. Call when the user " +
    "references 'what I just copied', '这段', 'this text', 'translate my " +
    "copied text', or wants you to operate on something they pasted somewhere. " +
    'Returns the current text in the clipboard (may be empty). ' +
    'Privacy: clipboard may contain passwords / secrets — be discrete.',
  input_schema: { type: 'object', properties: {}, required: [] }
}

export const OPEN_URL: ToolDef = {
  name: 'open_url',
  description:
    "Open a URL in the user's default browser. Use when you want to direct " +
    'them to a documentation page, a search result, or any web resource ' +
    'relevant to their question. Only http(s) URLs allowed.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Fully-qualified http(s) URL'
      }
    },
    required: ['url']
  }
}

export const COPY_TO_CLIPBOARD: ToolDef = {
  name: 'copy_to_clipboard',
  description:
    "Replace the user's clipboard with the given text. Use when the user " +
    "asks to 'copy this to clipboard', '帮我准备 X 到剪贴板', or when you " +
    'produced a command / URL / code snippet that the user clearly wants ' +
    'to paste somewhere next. After calling, tell the user it is ready.',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to write to the clipboard. Max 100,000 chars.'
      }
    },
    required: ['text']
  }
}

export const CURRENT_APP_INFO: ToolDef = {
  name: 'current_app_info',
  description:
    "Check which macOS app the user currently has in focus and what they " +
    "appear to be doing (coding / writing / chatting / terminal / idle). Useful " +
    'when the user asks "what am I doing", "我在干啥", or when you need ' +
    'context to give a relevant answer (e.g., recommending tools fitting ' +
    'their current activity). Returns app name + bundle id + activity label.',
  input_schema: { type: 'object', properties: {}, required: [] }
}

/** 当前导出给 AI 的 tool 池（按需 enable） */
export const ALL_TOOLS = [
  VIEW_SCREEN,
  READ_CLIPBOARD,
  OPEN_URL,
  COPY_TO_CLIPBOARD,
  CURRENT_APP_INFO
] as const

// ============================================================================
// 执行器
// ============================================================================

const CLIPBOARD_MAX = 100_000

/**
 * 统一 tool 调度。input 由 AI 生成的 JSON object，注意 runtime 类型校验。
 * 失败时返回 ok:false + 人类可读 error，让 AI 在回答时自然引导用户。
 */
export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case 'view_screen':
      return await execViewScreen(ctx)
    case 'read_clipboard':
      return execReadClipboard()
    case 'open_url':
      return await execOpenUrl(input)
    case 'copy_to_clipboard':
      return execCopyToClipboard(input)
    case 'current_app_info':
      return execCurrentAppInfo(ctx)
    default:
      return { ok: false, error: `unknown tool: ${name}` }
  }
}

async function execViewScreen(ctx: ToolContext): Promise<ToolResult> {
  const cap = await captureForTool(ctx.petWindow)
  if (!cap.ok) {
    return { ok: false, error: cap.error }
  }
  return {
    ok: true,
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: cap.mediaType, data: cap.data }
      }
    ]
  }
}

function execReadClipboard(): ToolResult {
  const text = clipboard.readText()
  if (!text) {
    return { ok: true, content: '(剪贴板为空 / 不是文本内容)' }
  }
  // 不写日志、不持久化（隐私）
  return { ok: true, content: text.slice(0, CLIPBOARD_MAX) }
}

async function execOpenUrl(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { url: string }' }
  }
  const url = (input as { url?: unknown }).url
  if (typeof url !== 'string') {
    return { ok: false, error: 'url must be a string' }
  }
  // 严格校验 http(s) 防 file:// / javascript: 等
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `invalid URL: ${url}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `only http/https allowed, got: ${parsed.protocol}` }
  }
  try {
    await shell.openExternal(parsed.toString())
    return { ok: true, content: `Opened ${parsed.toString()} in default browser.` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `openExternal failed: ${msg}` }
  }
}

function execCopyToClipboard(input: unknown): ToolResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { text: string }' }
  }
  const text = (input as { text?: unknown }).text
  if (typeof text !== 'string') {
    return { ok: false, error: 'text must be a string' }
  }
  if (text.length > CLIPBOARD_MAX) {
    return { ok: false, error: `text too long: ${text.length} > ${CLIPBOARD_MAX}` }
  }
  clipboard.writeText(text)
  return {
    ok: true,
    content: `Wrote ${text.length} chars to clipboard. User can cmd+V to paste.`
  }
}

function execCurrentAppInfo(ctx: ToolContext): ToolResult {
  const lines = [
    `front_app_name: ${ctx.currentAppName || '(unknown)'}`,
    `bundle_id: ${ctx.currentAppBundleId || '(unknown)'}`,
    `activity: ${ctx.currentActivity}`
  ]
  return { ok: true, content: lines.join('\n') }
}
