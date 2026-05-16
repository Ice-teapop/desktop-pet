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
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import type { ActivityState } from '../../shared/chat-types'
import { captureForTool } from '../services/vision-pipeline'
import { isPathSafe } from './path-safety'
import { checkCommand } from './command-whitelist'
import { checkTrusted, requestApproval } from './approval'
import { logToolAction } from '../audit-log'

const execAsync = promisify(exec)

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
  /** Tavily Search API key —— null = web_search tool 未启用 */
  tavilyApiKey: string | null
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

// ============================================================================
// M4-C Batch A: 文件系统 + 终端 + 系统设置 tools
// ============================================================================

export const READ_FILE: ToolDef = {
  name: 'read_file',
  description:
    "Read a text file from the user's filesystem. Use when the user asks " +
    "about a specific file's content, or you need context to answer (e.g., " +
    "'check my package.json'). Path can be absolute or ~-relative. Returns " +
    'up to first 50,000 chars. SAFETY: ~/.ssh/.aws/etc are always denied; ' +
    'other paths may show a permission modal for the user to approve / trust.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path or ~/-relative path to a text file'
      }
    },
    required: ['path']
  }
}

export const LIST_DIRECTORY: ToolDef = {
  name: 'list_directory',
  description:
    "List the entries of a directory. Returns file/dir names + types " +
    '(file/directory) + size for files. Up to 200 entries. SAFETY: ' +
    'sensitive dirs (.ssh / Keychains / browser data) are always denied; ' +
    'other dirs may show a permission modal.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or ~/-relative directory path'
      }
    },
    required: ['path']
  }
}

export const RUN_COMMAND: ToolDef = {
  name: 'run_command',
  description:
    'Run a shell command in the user\'s default shell. Safe read-only ' +
    "commands (ls/cat/pwd/git status/log/diff/branch/ps/df/echo/which/wc/" +
    "stat/file/uname/date/whoami/brew list/npm list/pip list) run silently. " +
    "Other commands show a permission modal. " +
    'SAFETY: rm -rf / / sudo / curl|sh / dd / mkfs etc are permanently ' +
    'denied even with approval. stdout truncated to 20,000 chars; ' +
    '30s timeout. Use this for queries — not for destructive ops.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Single-line shell command (no &&/;/|/> chaining preferred)'
      },
      cwd: {
        type: 'string',
        description:
          "Working directory (optional, defaults to user's HOME). " +
          'Must be in a safe path; same safety rules as read_file apply.'
      }
    },
    required: ['command']
  }
}

export const OPEN_SYSTEM_SETTINGS: ToolDef = {
  name: 'open_system_settings',
  description:
    "Open a specific macOS System Settings pane (does NOT change anything, " +
    'only navigates the user there). Use when the user asks how to find a ' +
    "setting (e.g., 'where do I enable screen recording?'). Returns ok " +
    'after the pane opens.',
  input_schema: {
    type: 'object',
    properties: {
      pane: {
        type: 'string',
        description: 'Settings pane identifier',
        enum: [
          'privacy_screen_recording',
          'privacy_accessibility',
          'privacy_files',
          'privacy_full_disk',
          'privacy_camera',
          'privacy_microphone',
          'privacy_location',
          'network',
          'displays',
          'bluetooth',
          'sound',
          'keyboard',
          'mouse',
          'trackpad',
          'general',
          'appearance',
          'desktop_dock',
          'notifications',
          'battery',
          'date_time',
          'sharing',
          'users',
          'spotlight'
        ]
      }
    },
    required: ['pane']
  }
}

export const WRITE_FILE: ToolDef = {
  name: 'write_file',
  description:
    'Write text content to a file (creates if missing, overwrites if exists). ' +
    "Use freely to create / modify the user's documents, code, notes etc. " +
    'SAFETY: ~/.ssh /.aws /.env / Keychain / browser data 等永远禁；HOME 下 ' +
    'visible 顶级目录默认信任不弹 modal；其它路径弹 modal 等用户确认。' +
    'Returns confirmation with bytes written.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or ~/-relative path' },
      content: {
        type: 'string',
        description: 'Full UTF-8 text content to write. Max 1MB.'
      }
    },
    required: ['path', 'content']
  }
}

export const CREATE_DIRECTORY: ToolDef = {
  name: 'create_directory',
  description:
    'Create a directory (recursive, like mkdir -p). Use when user asks to ' +
    'create a folder or when write_file needs a parent that does not exist. ' +
    'Same safety rules as write_file.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or ~/-relative directory path' }
    },
    required: ['path']
  }
}

export const FIND_FILES: ToolDef = {
  name: 'find_files',
  description:
    'Recursively find files under a directory by filename glob pattern. ' +
    "Use when user references a file by name without giving a path " +
    "('我那个 idea.md 在哪'). Returns up to 50 matching absolute paths. " +
    'Searches the directory tree but skips hidden dirs (.*) and node_modules / ' +
    '__pycache__ / .git / build / dist / target / venv. Same path safety rules.',
  input_schema: {
    type: 'object',
    properties: {
      root: {
        type: 'string',
        description: 'Directory to search under (absolute or ~/-relative). Defaults to ~'
      },
      name_pattern: {
        type: 'string',
        description:
          "Filename glob. Use * for any chars, ? for one char. Case-insensitive. " +
          "Examples: 'idea.md', '*.ts', 'notes-*'"
      }
    },
    required: ['name_pattern']
  }
}

export const DELETE_FILE: ToolDef = {
  name: 'delete_file',
  description:
    'Delete a file or empty directory. ⚠️ Irreversible —— ALWAYS shows ' +
    'a confirmation modal (no auto-trust). Use sparingly; consider asking ' +
    'user before calling. For non-empty dirs use run_command with explicit ' +
    'user-approved `rm -r` command.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or ~/-relative path to delete' }
    },
    required: ['path']
  }
}

export const FETCH_URL: ToolDef = {
  name: 'fetch_url',
  description:
    'Fetch a URL and return its body content. Use to read articles, ' +
    "documentation pages, API responses, or anything HTTP-accessible. " +
    'Only http(s) public URLs allowed; local addresses (127.0.0.1 / 10.x / ' +
    "192.168.x / 169.254.x / .local) rejected. First fetch per domain shows " +
    'a modal. Body capped at 500KB; text-like content types are returned ' +
    'as-is; HTML is stripped to text; binary returns size info only.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public http(s) URL' }
    },
    required: ['url']
  }
}

export const WEB_SEARCH: ToolDef = {
  name: 'web_search',
  description:
    'Search the web via Tavily (AI-friendly search engine). Returns an ' +
    "AI-summarized answer (if available) + top result snippets with URLs. " +
    'Use when user asks about facts that need fresh info, current events, ' +
    "specific docs you don't have memorized, or to find canonical pages " +
    'before fetch_url. Privacy: query goes to api.tavily.com.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query in natural language' },
      max_results: {
        type: 'string',
        description: 'Optional 1-10, defaults to 5'
      }
    },
    required: ['query']
  }
}

export const READ_SYSTEM_PREFERENCE: ToolDef = {
  name: 'read_system_preference',
  description:
    "Read a macOS user preference value via `defaults read <domain> [key]`. " +
    "Use for non-sensitive prefs (e.g., 'what dock icon size is configured'). " +
    "Returns the value as text. Some domains are denied (Keychain / passwords). " +
    'Approval modal shown for the first read per domain in a session.',
  input_schema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description:
          "Preference domain (e.g., 'com.apple.dock', 'NSGlobalDomain'). " +
          'Not all domains supported — sensitive ones are denied.'
      },
      key: {
        type: 'string',
        description: 'Optional specific key. If omitted, returns whole domain plist.'
      }
    },
    required: ['domain']
  }
}

/** 不依赖外部 API key 的核心 tool 池 —— 始终暴露给 AI（在 agentic toggle 开时）。 */
const CORE_TOOLS = [
  VIEW_SCREEN,
  READ_CLIPBOARD,
  OPEN_URL,
  COPY_TO_CLIPBOARD,
  CURRENT_APP_INFO,
  READ_FILE,
  LIST_DIRECTORY,
  WRITE_FILE,
  CREATE_DIRECTORY,
  FIND_FILES,
  DELETE_FILE,
  RUN_COMMAND,
  OPEN_SYSTEM_SETTINGS,
  READ_SYSTEM_PREFERENCE,
  FETCH_URL
] as const

/**
 * 按 ToolContext 中存在的能力筛选可用 tools。
 * 例：tavilyApiKey=null → web_search 不暴露给 AI（AI 不会瞎调一个无 key 的 tool）。
 */
export function buildToolsForContext(ctx: ToolContext): readonly ToolDef[] {
  const tools: ToolDef[] = [...CORE_TOOLS]
  if (ctx.tavilyApiKey) tools.push(WEB_SEARCH)
  return tools
}

/** Deprecated：保留导出兼容老调用方；prefer buildToolsForContext */
export const ALL_TOOLS = CORE_TOOLS

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
    case 'read_file':
      return await execReadFile(input)
    case 'list_directory':
      return await execListDirectory(input)
    case 'write_file':
      return await execWriteFile(input)
    case 'create_directory':
      return await execCreateDirectory(input)
    case 'find_files':
      return await execFindFiles(input)
    case 'delete_file':
      return await execDeleteFile(input)
    case 'run_command':
      return await execRunCommand(input)
    case 'open_system_settings':
      return await execOpenSystemSettings(input)
    case 'read_system_preference':
      return await execReadSystemPreference(input)
    case 'fetch_url':
      return await execFetchUrl(input)
    case 'web_search':
      return await execWebSearch(input, ctx)
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

// ============================================================================
// M4-C Batch A executors
// ============================================================================

const READ_FILE_MAX = 50_000 // chars
const RUN_COMMAND_TIMEOUT_MS = 30_000
const RUN_COMMAND_MAX_STDOUT = 20_000 // chars per stream

/**
 * 统一的 path approval helper：
 *  1. Layer 1+2 黑名单 → 直接 deny（不弹 modal）
 *  2. trusted dir → auto-allow（不弹 modal）
 *  3. 否则 弹 modal 等用户决策
 * 返回 { ok:true, absPath } / { ok:false, error }
 */
async function requestPathApprovalWithPreview(
  rawPath: string,
  tool: string,
  summaryVerb: string,
  contentPreview: string
): Promise<{ ok: true; absPath: string } | { ok: false; error: string }> {
  return requestPathApprovalInner(rawPath, tool, summaryVerb, contentPreview)
}

async function requestPathApproval(
  rawPath: string,
  tool: string,
  summaryVerb: string
): Promise<{ ok: true; absPath: string } | { ok: false; error: string }> {
  return requestPathApprovalInner(rawPath, tool, summaryVerb, undefined)
}

async function requestPathApprovalInner(
  rawPath: string,
  tool: string,
  summaryVerb: string,
  contentPreview: string | undefined
): Promise<{ ok: true; absPath: string } | { ok: false; error: string }> {
  const safety = isPathSafe(rawPath)
  if (!safety.ok) {
    await logToolAction({
      tool,
      argsSummary: `path=${rawPath}`,
      result: 'denied',
      detail: safety.reason
    })
    return { ok: false, error: `路径被静态黑名单拦截: ${safety.reason}` }
  }
  const trust = checkTrusted(safety.absPath)
  if (trust) {
    await logToolAction({
      tool,
      argsSummary: `path=${safety.absPath}`,
      result: 'auto-trusted',
      detail: `trust=${trust}`
    })
    return { ok: true, absPath: safety.absPath }
  }
  const decision = await requestApproval({
    tool,
    summary: `AI 想${summaryVerb}：${safety.absPath}`,
    path: safety.absPath,
    ...(contentPreview ? { contentPreview } : {})
  })
  if (decision === 'deny') {
    await logToolAction({
      tool,
      argsSummary: `path=${safety.absPath}`,
      result: 'denied',
      detail: 'user denied'
    })
    return { ok: false, error: '用户拒绝了本次访问' }
  }
  await logToolAction({
    tool,
    argsSummary: `path=${safety.absPath}`,
    result: 'ok',
    detail: `user decision: ${decision}`
  })
  return { ok: true, absPath: safety.absPath }
}

async function execReadFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path: string }' }
  }
  const rawPath = (input as { path?: unknown }).path
  if (typeof rawPath !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  const gate = await requestPathApproval(rawPath, 'read_file', '读取文件')
  if (!gate.ok) return gate
  try {
    const stat = await fs.stat(gate.absPath)
    if (!stat.isFile()) {
      return { ok: false, error: `不是文件: ${gate.absPath}` }
    }
    if (stat.size > 10 * 1024 * 1024) {
      return { ok: false, error: `文件太大 (${stat.size} bytes > 10MB)` }
    }
    const raw = await fs.readFile(gate.absPath, 'utf8')
    const truncated = raw.length > READ_FILE_MAX
    const content = truncated
      ? raw.slice(0, READ_FILE_MAX) +
        `\n\n... (truncated, file has ${raw.length} chars total)`
      : raw
    return { ok: true, content }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `readFile failed: ${msg}` }
  }
}

const WRITE_FILE_MAX = 1_000_000 // 1MB UTF-8 chars
const FIND_FILES_MAX_RESULTS = 50
const FIND_FILES_SKIP_DIRS = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  '.svn',
  'build',
  'dist',
  'target',
  'venv',
  '.venv',
  '.next',
  '.turbo',
  '.cache'
])

async function execWriteFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path: string, content: string }' }
  }
  const obj = input as { path?: unknown; content?: unknown }
  if (typeof obj.path !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  if (typeof obj.content !== 'string') {
    return { ok: false, error: 'content must be a string' }
  }
  if (obj.content.length > WRITE_FILE_MAX) {
    return { ok: false, error: `content too long: ${obj.content.length} > ${WRITE_FILE_MAX}` }
  }
  const gate = await requestPathApprovalWithPreview(
    obj.path,
    'write_file',
    '写入文件',
    obj.content.slice(0, 200)
  )
  if (!gate.ok) return gate
  try {
    await fs.writeFile(gate.absPath, obj.content, { encoding: 'utf8', mode: 0o644 })
    return {
      ok: true,
      content: `Wrote ${obj.content.length} chars to ${gate.absPath}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `writeFile failed: ${msg}` }
  }
}

async function execCreateDirectory(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path: string }' }
  }
  const rawPath = (input as { path?: unknown }).path
  if (typeof rawPath !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  const gate = await requestPathApproval(rawPath, 'create_directory', '创建目录')
  if (!gate.ok) return gate
  try {
    await fs.mkdir(gate.absPath, { recursive: true })
    return { ok: true, content: `Created directory: ${gate.absPath}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `mkdir failed: ${msg}` }
  }
}

/** glob → regex 极简（仅支持 * 和 ?）。case-insensitive 匹配文件名。 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const re = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  return new RegExp(re, 'i')
}

async function execFindFiles(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { root?: string, name_pattern: string }' }
  }
  const obj = input as { root?: unknown; name_pattern?: unknown }
  if (typeof obj.name_pattern !== 'string' || !obj.name_pattern) {
    return { ok: false, error: 'name_pattern required' }
  }
  const rootInput = typeof obj.root === 'string' && obj.root.trim() ? obj.root : '~'
  const rootSafety = isPathSafe(rootInput)
  if (!rootSafety.ok) {
    return { ok: false, error: `root 路径不安全: ${rootSafety.reason}` }
  }
  // find 不弹 modal（只读元信息 + 默认信任 scope 内）—— 但仍走 trust 检查
  const trust = checkTrusted(rootSafety.absPath)
  if (!trust) {
    const decision = await requestApproval({
      tool: 'find_files',
      summary: `AI 想在目录里搜索文件：${rootSafety.absPath}`,
      path: rootSafety.absPath
    })
    if (decision === 'deny') {
      return { ok: false, error: '用户拒绝在该目录搜索' }
    }
  }
  const re = globToRegex(obj.name_pattern)
  const found: string[] = []

  async function walk(dir: string, depthLeft: number): Promise<void> {
    if (depthLeft < 0 || found.length >= FIND_FILES_MAX_RESULTS) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // 没权限读 / 不存在，跳过
    }
    for (const e of entries) {
      if (found.length >= FIND_FILES_MAX_RESULTS) return
      // 跳过 hidden + 常见构建产物目录
      if (e.name.startsWith('.') && e.name !== '.') continue
      if (e.isDirectory() && FIND_FILES_SKIP_DIRS.has(e.name)) continue
      const full = dir + '/' + e.name
      if (e.isFile() && re.test(e.name)) {
        // 黑名单 cross-check：跳过 .env 等敏感文件即使匹配
        const safety = isPathSafe(full)
        if (safety.ok) found.push(full)
      }
      if (e.isDirectory()) {
        await walk(full, depthLeft - 1)
      }
    }
  }

  await walk(rootSafety.absPath, 6) // 深度限制防爆栈
  await logToolAction({
    tool: 'find_files',
    argsSummary: `root=${rootSafety.absPath} pattern=${obj.name_pattern}`,
    result: 'ok',
    detail: `found ${found.length}`
  })
  if (found.length === 0) {
    return {
      ok: true,
      content: `No files matching "${obj.name_pattern}" under ${rootSafety.absPath}`
    }
  }
  return {
    ok: true,
    content: found.slice(0, FIND_FILES_MAX_RESULTS).join('\n')
  }
}

async function execDeleteFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path: string }' }
  }
  const rawPath = (input as { path?: unknown }).path
  if (typeof rawPath !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  // delete 不享受默认信任：始终弹 modal
  const safety = isPathSafe(rawPath)
  if (!safety.ok) {
    return { ok: false, error: `路径被静态黑名单拦截: ${safety.reason}` }
  }
  const decision = await requestApproval({
    tool: 'delete_file',
    summary: `⚠️ AI 想删除：${safety.absPath}（不可恢复）`,
    path: safety.absPath
  })
  if (decision === 'deny') {
    await logToolAction({
      tool: 'delete_file',
      argsSummary: `path=${safety.absPath}`,
      result: 'denied',
      detail: 'user denied'
    })
    return { ok: false, error: '用户拒绝删除' }
  }
  await logToolAction({
    tool: 'delete_file',
    argsSummary: `path=${safety.absPath}`,
    result: 'ok',
    detail: `approved: ${decision}`
  })
  try {
    const stat = await fs.stat(safety.absPath)
    if (stat.isDirectory()) {
      await fs.rmdir(safety.absPath) // 仅空目录
    } else {
      await fs.unlink(safety.absPath)
    }
    return { ok: true, content: `Deleted: ${safety.absPath}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `delete failed: ${msg}` }
  }
}

async function execListDirectory(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path: string }' }
  }
  const rawPath = (input as { path?: unknown }).path
  if (typeof rawPath !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  const gate = await requestPathApproval(rawPath, 'list_directory', '列出目录')
  if (!gate.ok) return gate
  try {
    const stat = await fs.stat(gate.absPath)
    if (!stat.isDirectory()) {
      return { ok: false, error: `不是目录: ${gate.absPath}` }
    }
    const entries = await fs.readdir(gate.absPath, { withFileTypes: true })
    const limited = entries.slice(0, 200)
    const lines: string[] = [`# ${gate.absPath}`, `# ${entries.length} entries (showing ${limited.length})`]
    for (const e of limited) {
      const kind = e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file'
      lines.push(`${kind}\t${e.name}`)
    }
    return { ok: true, content: lines.join('\n') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `readdir failed: ${msg}` }
  }
}

async function execRunCommand(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { command: string, cwd?: string }' }
  }
  const obj = input as { command?: unknown; cwd?: unknown }
  const cmd = obj.command
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return { ok: false, error: 'command must be a non-empty string' }
  }
  const check = checkCommand(cmd)
  if (check.level === 'deny') {
    await logToolAction({
      tool: 'run_command',
      argsSummary: `cmd=${cmd.slice(0, 80)}`,
      result: 'denied',
      detail: `hard-deny: ${check.reason}`
    })
    return { ok: false, error: `命令被永久拒绝: ${check.reason}` }
  }
  // cwd 处理 + 路径安全
  let cwd = process.env.HOME || '/'
  if (typeof obj.cwd === 'string' && obj.cwd.trim()) {
    const cwdSafety = isPathSafe(obj.cwd)
    if (!cwdSafety.ok) {
      return { ok: false, error: `cwd 路径不安全: ${cwdSafety.reason}` }
    }
    cwd = cwdSafety.absPath
  }
  if (check.level === 'needs-approval') {
    const decision = await requestApproval({
      tool: 'run_command',
      summary: `AI 想执行命令：${cmd}`,
      command: cmd,
      path: cwd
    })
    if (decision === 'deny') {
      await logToolAction({
        tool: 'run_command',
        argsSummary: `cmd=${cmd.slice(0, 80)}`,
        result: 'denied',
        detail: 'user denied'
      })
      return { ok: false, error: '用户拒绝执行该命令' }
    }
    await logToolAction({
      tool: 'run_command',
      argsSummary: `cmd=${cmd.slice(0, 80)} cwd=${cwd}`,
      result: 'ok',
      detail: `approved: ${decision}`
    })
  } else {
    await logToolAction({
      tool: 'run_command',
      argsSummary: `cmd=${cmd.slice(0, 80)} cwd=${cwd}`,
      result: 'whitelist'
    })
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: RUN_COMMAND_TIMEOUT_MS,
      maxBuffer: RUN_COMMAND_MAX_STDOUT * 4,
      // 不继承 main 的环境敏感变量
      env: { ...process.env, ANTHROPIC_API_KEY: '', DESKPET_VISION_TOKEN: '' }
    })
    const truncate = (s: string): string =>
      s.length > RUN_COMMAND_MAX_STDOUT
        ? s.slice(0, RUN_COMMAND_MAX_STDOUT) + `\n... (truncated)`
        : s
    return {
      ok: true,
      content: `# stdout\n${truncate(stdout)}` + (stderr ? `\n\n# stderr\n${truncate(stderr)}` : '')
    }
  } catch (err) {
    // execAsync rejects when exit code != 0 or signaled —— 把 stdout/stderr 一并回给 AI
    const e = err as { stdout?: string; stderr?: string; code?: number; signal?: string; message?: string }
    const stdout = e.stdout ?? ''
    const stderr = e.stderr ?? e.message ?? ''
    return {
      ok: false,
      error:
        `exit code ${e.code ?? '?'} signal=${e.signal ?? 'none'}\n` +
        `stdout: ${stdout.slice(0, 1000)}\nstderr: ${stderr.slice(0, 1000)}`
    }
  }
}

// macOS Settings pane → x-apple.systempreferences URL 映射
const SETTINGS_PANE_URL: Record<string, string> = {
  privacy_screen_recording:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  privacy_accessibility:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  privacy_files: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  privacy_full_disk:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  privacy_camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  privacy_microphone:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  privacy_location:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  network: 'x-apple.systempreferences:com.apple.preference.network',
  displays: 'x-apple.systempreferences:com.apple.preference.displays',
  bluetooth: 'x-apple.systempreferences:com.apple.preference.bluetooth',
  sound: 'x-apple.systempreferences:com.apple.preference.sound',
  keyboard: 'x-apple.systempreferences:com.apple.preference.keyboard',
  mouse: 'x-apple.systempreferences:com.apple.preference.mouse',
  trackpad: 'x-apple.systempreferences:com.apple.preference.trackpad',
  general: 'x-apple.systempreferences:com.apple.preference.general',
  appearance: 'x-apple.systempreferences:com.apple.preference.appearance',
  desktop_dock: 'x-apple.systempreferences:com.apple.preference.dock',
  notifications: 'x-apple.systempreferences:com.apple.preference.notifications',
  battery: 'x-apple.systempreferences:com.apple.preference.battery',
  date_time: 'x-apple.systempreferences:com.apple.preference.datetime',
  sharing: 'x-apple.systempreferences:com.apple.preference.sharing',
  users: 'x-apple.systempreferences:com.apple.preferences.users',
  spotlight: 'x-apple.systempreferences:com.apple.preference.spotlight'
}

async function execOpenSystemSettings(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { pane: string }' }
  }
  const pane = (input as { pane?: unknown }).pane
  if (typeof pane !== 'string') {
    return { ok: false, error: 'pane must be a string' }
  }
  const url = SETTINGS_PANE_URL[pane]
  if (!url) {
    return { ok: false, error: `unknown pane: ${pane}. supported: ${Object.keys(SETTINGS_PANE_URL).join(', ')}` }
  }
  try {
    await shell.openExternal(url)
    await logToolAction({
      tool: 'open_system_settings',
      argsSummary: `pane=${pane}`,
      result: 'ok'
    })
    return { ok: true, content: `已打开「${pane}」系统设置面板` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `openExternal failed: ${msg}` }
  }
}

// defaults read 黑名单 —— 这些 domain 永远拒绝（含密码 / 密钥）
const DEFAULTS_DOMAIN_BLACKLIST: RegExp[] = [
  /Keychain/i,
  /\.password/i,
  /\.credential/i,
  /\.secret/i
]

// ============================================================================
// M4-D: Web tools
// ============================================================================

const FETCH_URL_TIMEOUT_MS = 15_000
const FETCH_URL_MAX_BYTES = 500_000
const FETCH_URL_MAX_CHARS = 30_000

/** 私网 / 元数据 IP 黑名单 —— SSRF 防御 */
const PRIVATE_HOST_REGEX = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+$/, // 172.16-31.x.x
  /^169\.254\.\d+\.\d+$/, // 链路本地 + AWS/GCP metadata 169.254.169.254
  /\.local$/i,
  /\.internal$/i,
  /^fc[\da-f]{2}:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
  /^\[::1\]$/
]

/** 已批准过 fetch 的 host 集合（会话级，main 退出即丢） */
const approvedFetchHosts = new Set<string>()

function isHostPrivate(hostname: string): boolean {
  for (const re of PRIVATE_HOST_REGEX) {
    if (re.test(hostname)) return true
  }
  return false
}

/** HTML → 简化文本（去 script/style/标签，保留换行 + 链接 anchor 文本）。 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|p|div|h[1-6]|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function execFetchUrl(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { url: string }' }
  }
  const url = (input as { url?: unknown }).url
  if (typeof url !== 'string') {
    return { ok: false, error: 'url must be a string' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `invalid URL: ${url}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `only http/https allowed, got ${parsed.protocol}` }
  }
  // SSRF: 拒私网 / metadata IP
  if (isHostPrivate(parsed.hostname)) {
    await logToolAction({
      tool: 'fetch_url',
      argsSummary: `host=${parsed.hostname}`,
      result: 'denied',
      detail: 'private host blocked (SSRF defense)'
    })
    return {
      ok: false,
      error: `禁止访问私网/本机地址: ${parsed.hostname}（防 SSRF）`
    }
  }
  // 同一 host 首次 → 弹 modal；之后 session 内静默
  if (!approvedFetchHosts.has(parsed.hostname)) {
    const decision = await requestApproval({
      tool: 'fetch_url',
      summary: `AI 想抓取网页：${parsed.hostname}${parsed.pathname}`,
      command: parsed.toString()
    })
    if (decision === 'deny') {
      await logToolAction({
        tool: 'fetch_url',
        argsSummary: `url=${parsed.toString().slice(0, 100)}`,
        result: 'denied',
        detail: 'user denied'
      })
      return { ok: false, error: '用户拒绝抓取该 URL' }
    }
    approvedFetchHosts.add(parsed.hostname)
    await logToolAction({
      tool: 'fetch_url',
      argsSummary: `host=${parsed.hostname}`,
      result: 'ok',
      detail: `approved: ${decision}, session-trusted host`
    })
  }
  // 抓取
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_URL_TIMEOUT_MS)
  try {
    const resp = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'DeskPet/0.1 (Electron; +https://github.com/Ice-teapop/desktop-pet)'
      }
    })
    if (!resp.ok) {
      return {
        ok: false,
        error: `HTTP ${resp.status} ${resp.statusText} for ${parsed.toString()}`
      }
    }
    const contentType = resp.headers.get('content-type') ?? ''
    // 读 body with size cap
    const reader = resp.body?.getReader()
    if (!reader) {
      return { ok: false, error: 'no response body' }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > FETCH_URL_MAX_BYTES) {
        await reader.cancel()
        return {
          ok: false,
          error: `response body > ${FETCH_URL_MAX_BYTES} bytes (capped)`
        }
      }
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks)
    if (contentType.startsWith('application/json')) {
      const txt = bytes.toString('utf8')
      try {
        const obj = JSON.parse(txt)
        return { ok: true, content: JSON.stringify(obj, null, 2).slice(0, FETCH_URL_MAX_CHARS) }
      } catch {
        return { ok: true, content: txt.slice(0, FETCH_URL_MAX_CHARS) }
      }
    }
    if (contentType.startsWith('text/html')) {
      const html = bytes.toString('utf8')
      const text = htmlToText(html)
      return { ok: true, content: text.slice(0, FETCH_URL_MAX_CHARS) }
    }
    if (contentType.startsWith('text/')) {
      return { ok: true, content: bytes.toString('utf8').slice(0, FETCH_URL_MAX_CHARS) }
    }
    return {
      ok: true,
      content: `(non-text content) Content-Type: ${contentType}, size: ${bytes.byteLength} bytes`
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'fetch timeout (15s)' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `fetch failed: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

interface TavilyResult {
  title: string
  url: string
  content: string
  score?: number
}
interface TavilyResponse {
  answer?: string
  results?: TavilyResult[]
  query?: string
}

async function execWebSearch(input: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tavilyApiKey) {
    return { ok: false, error: 'Tavily API key 未配置 —— 设置 TAVILY_API_KEY 环境变量或在设置面板填' }
  }
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { query: string, max_results?: string }' }
  }
  const obj = input as { query?: unknown; max_results?: unknown }
  if (typeof obj.query !== 'string' || !obj.query.trim()) {
    return { ok: false, error: 'query required' }
  }
  let maxResults = 5
  if (typeof obj.max_results === 'string') {
    const n = parseInt(obj.max_results, 10)
    if (!isNaN(n) && n >= 1 && n <= 10) maxResults = n
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.tavilyApiKey}`
      },
      body: JSON.stringify({
        query: obj.query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: true
      }),
      signal: controller.signal
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { ok: false, error: `Tavily HTTP ${resp.status}: ${text.slice(0, 300)}` }
    }
    const data = (await resp.json()) as TavilyResponse
    await logToolAction({
      tool: 'web_search',
      argsSummary: `query=${obj.query.slice(0, 80)}`,
      result: 'ok',
      detail: `${data.results?.length ?? 0} results`
    })
    // 格式化 AI 友好的输出
    const lines: string[] = []
    if (data.answer) {
      lines.push(`# Tavily-summarized answer\n${data.answer}\n`)
    }
    if (data.results && data.results.length > 0) {
      lines.push('# Top results')
      for (const r of data.results) {
        lines.push(`\n## ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 600)}`)
      }
    }
    if (lines.length === 0) {
      return { ok: true, content: '(no results)' }
    }
    return { ok: true, content: lines.join('\n').slice(0, 30_000) }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Tavily timeout (15s)' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Tavily call failed: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

async function execReadSystemPreference(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { domain: string, key?: string }' }
  }
  const obj = input as { domain?: unknown; key?: unknown }
  const domain = obj.domain
  if (typeof domain !== 'string' || !domain.trim()) {
    return { ok: false, error: 'domain must be a non-empty string' }
  }
  // shell injection 防御：domain / key 必须是合法 plist domain（字母数字 . - _）
  if (!/^[\w.-]+$/.test(domain)) {
    return { ok: false, error: 'domain contains invalid chars' }
  }
  for (const re of DEFAULTS_DOMAIN_BLACKLIST) {
    if (re.test(domain)) {
      await logToolAction({
        tool: 'read_system_preference',
        argsSummary: `domain=${domain}`,
        result: 'denied',
        detail: 'domain blacklisted'
      })
      return { ok: false, error: `domain 被黑名单拦截（含 password/keychain/secret）` }
    }
  }
  const key = obj.key
  if (key !== undefined && (typeof key !== 'string' || !/^[\w.-]+$/.test(key))) {
    return { ok: false, error: 'key must be string with [\\w.-] chars only' }
  }
  // 此 tool 不弹 modal（read-only + 黑名单已硬拦），audit log 即可
  const cmd = key ? `defaults read ${domain} ${key}` : `defaults read ${domain}`
  try {
    const { stdout } = await execAsync(cmd, { timeout: 5000, maxBuffer: 200_000 })
    await logToolAction({
      tool: 'read_system_preference',
      argsSummary: `domain=${domain} key=${key ?? '*'}`,
      result: 'ok'
    })
    return { ok: true, content: stdout.slice(0, 20_000) }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, error: e.stderr || e.message || 'defaults read failed' }
  }
}
