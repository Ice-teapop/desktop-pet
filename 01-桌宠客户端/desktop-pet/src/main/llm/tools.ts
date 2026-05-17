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
import { exec, execFile } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import type { ActivityState } from '../../shared/chat-types'
import type { Provider } from '../../shared/provider-types'
import {
  PET_ANIMATIONS,
  isPetAnimation,
  type PetAnimation
} from '../../shared/pet-state'
import { captureForTool } from '../services/vision-pipeline'
import { isPathSafe } from './path-safety'
import { checkCommand, tokenizeSafeCommand } from './command-whitelist'
import { checkTrusted, requestApproval } from './approval'
import { logToolAction } from '../audit-log'
import { appendMemory, MEMORY_LINE_MAX } from '../storage/pet-memory'
import { loadUserProfile, saveUserProfile } from '../storage/user-profile'
import type { PersonaPreset, UserProfile } from '../../shared/user-profile-types'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * M4-C-fix B2：env 白名单 —— spawn 子进程时只传必要的环境变量，防 process.env
 * 里的其它 secret (TAVILY_API_KEY / AWS_* / GH_TOKEN / OPENAI_API_KEY / 等) 通过
 * shell expansion 或 child read 泄漏。
 */
function safeChildEnv(): Record<string, string> {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'TMPDIR',
    'SHELL'
  ]
  const out: Record<string, string> = {}
  for (const k of allowed) {
    const v = process.env[k]
    if (typeof v === 'string') out[k] = v
  }
  return out
}

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
  /**
   * M7-6: 当前选定 provider —— `specialized-tools.ts` 据此决定 inject 哪些
   * provider 原生 server-side tool（anthropic_web_search / openai_code_interpreter /
   * google_search / xai_live_search 等）。chat:submit handler 从 currentSelectedModel
   * .provider 取值传入。
   */
  selectedProvider: Provider
  /**
   * M8: AI 调 set_pet_animation tool 时由 main 端执行的回调 —— 把 stateMachine
   * transition 到对应 PetAnimation 状态（juggling/sweeping/conducting/...）+
   * scheduleReturnToIdle 动画播完后回 idle。executor 仅校验 enum + 调 callback。
   */
  setPetAnimation: (name: PetAnimation) => void
  /**
   * M8: 当前 pet state 名（idle/sleep/thinking/juggling/etc）—— 注入 system
   * prompt 让 AI 知道自己 currently 在干啥（"pet 要知道自己现在是什么状态"）。
   */
  currentPetState: string
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

export const SET_PET_ANIMATION: ToolDef = {
  name: 'set_pet_animation',
  description:
    "Make the desktop pet (the pixel crab 🦀 in the bottom-right corner) PLAY " +
    'a specific animation so the user visually sees the pet doing something fun. ' +
    'Call this when the user asks the pet to perform/dance/show off/express a ' +
    `mood ("表演杂技" → juggling, "庆祝下" → celebrating, "扫地" → sweeping, etc). ` +
    'Also acceptable when YOUR text response would be more vivid with a visual ' +
    "complement (e.g. completing a complex task → 'celebrating'). " +
    'The animation auto-returns to idle after one cycle (2-3.5s); call it ONCE, ' +
    "don't loop the call. Calling with the same animation while it's playing is " +
    'a no-op. Available animations (pick the closest match in spirit):\n' +
    `  • juggling     —— 抛接小球，杂技 / 多任务 / 应付多件事 / 灵活\n` +
    `  • sweeping     —— 扫地 / 整理 / 清扫 / 收拾\n` +
    `  • conducting   —— 挥舞指挥棒，打节奏 / 指挥 / 音乐表演\n` +
    `  • grooving     —— 戴耳机摇摆，听音乐 / 沉浸 / 享受节奏\n` +
    `  • celebrating  —— 开心 / 庆祝 / 完成任务 / 高兴 / 谢谢用户`,
  input_schema: {
    type: 'object',
    properties: {
      animation: {
        type: 'string',
        description: 'One of the animation names listed above',
        enum: PET_ANIMATIONS as readonly string[] as string[]
      }
    },
    required: ['animation']
  }
}

export const SAVE_USER_PROFILE: ToolDef = {
  name: 'save_user_profile',
  description:
    "Save the user's profile collected during the first-time setup conversation. " +
    'Call this exactly ONCE at the end of setup, when you have collected: name ' +
    '(how to address them), about (their background/interests/projects), ' +
    'persona preset choice + optional custom additions. This marks setup as ' +
    'completed so future sessions skip the wizard. After calling, briefly ' +
    'acknowledge setup is done and let them know they can revise in Settings.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'How the user wants to be addressed (e.g., "Han")'
      },
      about: {
        type: 'string',
        description:
          'Free-form 1-3 sentences summarizing their background: ' +
          'job / projects / tech stack / interests / habits as user told you'
      },
      persona_preset: {
        type: 'string',
        enum: ['warm-friend', 'professional', 'witty-cold', 'playful', 'custom'],
        description:
          "Pet persona style preset chosen by user. " +
          "warm-friend = warm casual; professional = direct technical; " +
          "witty-cold = sarcastic-but-helpful; playful = banter-heavy; " +
          "custom = no preset, use persona_custom only"
      },
      persona_custom: {
        type: 'string',
        description:
          'Optional user additions on top of the preset (or full description ' +
          'if preset=custom). Empty string if nothing extra.'
      }
    },
    required: ['name', 'about', 'persona_preset', 'persona_custom']
  }
}

export const REMEMBER: ToolDef = {
  name: 'remember',
  description:
    "Persist a short fact about the user across sessions. Use ONLY for " +
    "truly important things user wants you to remember: how they prefer to " +
    "be called, recurring projects, persistent preferences, important " +
    "personal context. Do NOT call for transient stuff (today's weather, " +
    "one-off questions) or sensitive secrets (passwords, tokens). " +
    "Memory file auto-trimmed to 16KB; oldest entries dropped first.",
  input_schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description:
          'A concise single-line fact to remember (max 500 chars). ' +
          "Format suggestion: state the fact, not the conversation context " +
          "(e.g., 'User prefers to be called Han, not Hans' not 'Han said " +
          "to call him Han')."
      }
    },
    required: ['note']
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
    "Returns the value as text. Sensitive domains (Keychain / passwords / mail / " +
    'messages / safari / accounts / contacts / calendar / notes) are hard-denied ' +
    'by a domain regex blacklist. No approval modal — denied or executed silently.',
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
  FETCH_URL,
  REMEMBER,
  SAVE_USER_PROFILE,
  SET_PET_ANIMATION
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
    case 'remember':
      return await execRemember(input)
    case 'save_user_profile':
      return await execSaveUserProfile(input)
    case 'set_pet_animation':
      return execSetPetAnimation(input, ctx)
    default:
      return { ok: false, error: `unknown tool: ${name}` }
  }
}

/**
 * M8: AI 通过 set_pet_animation tool 触发 pet 表演动画。仅校验 enum +
 * 调 ctx.setPetAnimation 回调（main 端实现 stateMachine.transition + scheduleReturnToIdle）。
 */
function execSetPetAnimation(input: unknown, ctx: ToolContext): ToolResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { animation: string }' }
  }
  const name = (input as { animation?: unknown }).animation
  if (typeof name !== 'string' || !isPetAnimation(name)) {
    return {
      ok: false,
      error: `animation must be one of: ${PET_ANIMATIONS.join(', ')}`
    }
  }
  ctx.setPetAnimation(name)
  return { ok: true, content: `Pet started ${name} animation (auto-returns to idle after one cycle).` }
}

const VALID_PERSONA_PRESETS: PersonaPreset[] = [
  'warm-friend',
  'professional',
  'witty-cold',
  'playful',
  'custom'
]

async function execSaveUserProfile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be object' }
  }
  const obj = input as Record<string, unknown>
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    return { ok: false, error: 'name required' }
  }
  if (typeof obj.about !== 'string') {
    return { ok: false, error: 'about required (can be empty string)' }
  }
  const preset = obj.persona_preset
  if (typeof preset !== 'string' || !(VALID_PERSONA_PRESETS as string[]).includes(preset)) {
    return { ok: false, error: `persona_preset must be one of ${VALID_PERSONA_PRESETS.join(', ')}` }
  }
  if (typeof obj.persona_custom !== 'string') {
    return { ok: false, error: 'persona_custom must be string (empty allowed)' }
  }
  const profile: UserProfile = {
    name: obj.name.trim(),
    about: obj.about.trim(),
    personaPreset: preset as PersonaPreset,
    personaCustom: obj.persona_custom.trim(),
    setupCompleted: true
  }
  try {
    await saveUserProfile(profile)
    await logToolAction({
      tool: 'save_user_profile',
      argsSummary: `name=${profile.name.slice(0, 40)} preset=${profile.personaPreset}`,
      result: 'ok'
    })
    // 重读一遍验证（保险）
    void loadUserProfile()
    return {
      ok: true,
      content: `Saved profile for ${profile.name}. Setup complete.`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `save_user_profile failed: ${msg}` }
  }
}

async function execRemember(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { note: string }' }
  }
  const note = (input as { note?: unknown }).note
  if (typeof note !== 'string' || !note.trim()) {
    return { ok: false, error: 'note must be non-empty string' }
  }
  if (note.length > MEMORY_LINE_MAX * 2) {
    return { ok: false, error: `note too long, max ${MEMORY_LINE_MAX} chars` }
  }
  try {
    await appendMemory(note)
    await logToolAction({
      tool: 'remember',
      argsSummary: `note=${note.slice(0, 80)}`,
      result: 'ok'
    })
    return { ok: true, content: `Remembered. (Persisted to ~/Library/Application Support/DeskPet/pet-memory.md)` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `remember failed: ${msg}` }
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
  // cr-fix S1: 包 untrusted 标签防 clipboard 内容里的 prompt injection
  return { ok: true, content: wrapUntrusted('clipboard', {}, text.slice(0, CLIPBOARD_MAX)) }
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

/**
 * cr-fix S1：把外部读入的内容包成 untrusted XML 标签，AI 看到这种结构会按 system
 * prompt 的"不可信内容处理"纪律当 data 不当 instruction。
 *
 * 即使内容里写 "</external_content>" 试图闭合标签 + 注入指令，我们用 escape 把
 * 内容里的 `</external_content>` 替换掉防止闭合 —— attacker 只能让 AI 看到一坨被
 * 包裹的文本，无法跳出 untrusted scope。
 */
function wrapUntrusted(
  source: string,
  attrs: Record<string, string>,
  content: string
): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;').slice(0, 200)}"`)
    .join(' ')
  // 防 inner content 闭合 outer 标签：替换 `</external_content>` —— 容忍空白变体
  // 攻击者可能用 `</ external_content >` / `</\nexternal_content>` 等绕过
  const safe = content.replace(
    /<\s*\/\s*external_content\s*>/gi,
    '<\\/external_content>'
  )
  return `<external_content source="${source}"${attrStr ? ' ' + attrStr : ''} untrusted>\n${safe}\n</external_content>`
}

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
  const safety = await isPathSafe(rawPath)
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
    // cr-fix S1: 文件内容可能含 attacker-controlled prompt injection（user 下载到的
    // 文件、AI 之前写入的可疑文件等）—— 包 untrusted 标签
    return { ok: true, content: wrapUntrusted('file', { path: gate.absPath }, content) }
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
  const rootSafety = await isPathSafe(rootInput)
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

  // cr-fix S6：DoS 预算 —— entries 扫描总数 + 时间 hard cap
  const FIND_MAX_ENTRIES = 50_000
  const FIND_TIMEOUT_MS = 5000
  const startTime = Date.now()
  let entriesScanned = 0
  let aborted = false

  async function walk(dir: string, depthLeft: number): Promise<void> {
    if (aborted) return
    if (depthLeft < 0 || found.length >= FIND_FILES_MAX_RESULTS) return
    if (entriesScanned >= FIND_MAX_ENTRIES) {
      aborted = true
      return
    }
    if (Date.now() - startTime > FIND_TIMEOUT_MS) {
      aborted = true
      return
    }
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // 没权限读 / 不存在，跳过
    }
    for (const e of entries) {
      if (aborted) return
      entriesScanned++
      if (found.length >= FIND_FILES_MAX_RESULTS) return
      if (entriesScanned >= FIND_MAX_ENTRIES || Date.now() - startTime > FIND_TIMEOUT_MS) {
        aborted = true
        return
      }
      // 跳过 hidden + 常见构建产物目录
      if (e.name.startsWith('.') && e.name !== '.') continue
      if (e.isDirectory() && FIND_FILES_SKIP_DIRS.has(e.name)) continue
      const full = dir + '/' + e.name
      if (e.isFile() && re.test(e.name)) {
        // 黑名单 cross-check：跳过 .env 等敏感文件即使匹配
        const safety = await isPathSafe(full)
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
    detail: `found ${found.length}${aborted ? ` (aborted: budget exceeded after scanning ${entriesScanned} entries / ${Date.now() - startTime}ms)` : ''}`
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
  const safety = await isPathSafe(rawPath)
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
    const cwdSafety = await isPathSafe(obj.cwd)
    if (!cwdSafety.ok) {
      return { ok: false, error: `cwd 路径不安全: ${cwdSafety.reason}` }
    }
    cwd = cwdSafety.absPath
  }

  // —— SAFE 路径：B1 修复 —— 抽取 path 类参数过 isPathSafe + 走 spawn shell:false ——
  if (check.level === 'safe') {
    const tokens = tokenizeSafeCommand(cmd)
    if (tokens.length === 0) return { ok: false, error: 'empty command tokens' }
    // 任何"看起来是路径"的 token（含 / 或 ~ 或 . 开头）都必须过 path-safety
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.startsWith('-')) continue // flag
      if (t.includes('/') || t.startsWith('~') || t.startsWith('.')) {
        const safety = await isPathSafe(t)
        if (!safety.ok) {
          await logToolAction({
            tool: 'run_command',
            argsSummary: `cmd=${cmd.slice(0, 80)}`,
            result: 'denied',
            detail: `path token blocked: ${safety.reason}`
          })
          return {
            ok: false,
            error: `命令参数路径不安全 (${t}): ${safety.reason}`
          }
        }
      }
    }
    await logToolAction({
      tool: 'run_command',
      argsSummary: `cmd=${cmd.slice(0, 80)} cwd=${cwd}`,
      result: 'whitelist'
    })
    try {
      const argv0 = tokens[0]
      const args = tokens.slice(1)
      const { stdout, stderr } = await execFileAsync(argv0, args, {
        cwd,
        timeout: RUN_COMMAND_TIMEOUT_MS,
        maxBuffer: RUN_COMMAND_MAX_STDOUT * 4,
        env: safeChildEnv(),
        shell: false // 关键：safe 路径不走 shell 防 metachar 后门
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

  // —— needs-approval 路径：弹 modal，shell:true（user 授权下保留 shell 能力）——
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
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: RUN_COMMAND_TIMEOUT_MS,
      maxBuffer: RUN_COMMAND_MAX_STDOUT * 4,
      env: safeChildEnv() // B2 修复：白名单 env（user-approved 也不该泄 secret）
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

// defaults read 黑名单 —— 这些 domain 永远拒绝（含密码 / 密钥 / 隐私数据）
// cr-fix S5：扩充覆盖 Mail / Messages / Calendar / Contacts / Safari / Accounts
const DEFAULTS_DOMAIN_BLACKLIST: RegExp[] = [
  /Keychain/i,
  /\.password/i,
  /\.credential/i,
  /\.secret/i,
  /\.token/i,
  /\.mail/i,
  /Messages/i,
  /Calendar/i,
  /Contact/i,
  /AddressBook/i,
  /Safari/i,
  /Accounts/i,
  /com\.apple\.identityservices/i,
  /com\.apple\.notes/i,
  /com\.apple\.AppleAccount/i
]

// ============================================================================
// M4-D: Web tools
// ============================================================================

const FETCH_URL_TIMEOUT_MS = 15_000
const FETCH_URL_MAX_BYTES = 500_000
const FETCH_URL_MAX_CHARS = 30_000

/**
 * 已批准过 fetch 的 host 集合（会话级，main 退出即丢）。
 * 注意：host 必须先过 SSRF 校验（dns 解析后 IP 不私网）才入这个 set；后续 redirect
 * 即使到同 host 仍要重做校验（防 DNS rebinding）。
 */
const approvedFetchHosts = new Set<string>()

/**
 * 名字白名单：用户明确 reject .local/.internal/.lan 等内部 TLD 字面（不解析 DNS）。
 * 注意只匹配 hostname 字面，不解析 —— DNS lookup 才是 SSRF 主防线。
 */
const INTERNAL_TLD_REGEX = /\.(local|internal|lan|home|corp|intranet)$/i

/**
 * IPv4 私网 / 保留段 + AWS/GCP/Azure metadata 黑名单（解析后的实际 IP 字面）。
 */
function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true
  const [a, b] = parts
  // 0.0.0.0/8
  if (a === 0) return true
  // 127.0.0.0/8 loopback
  if (a === 127) return true
  // 10.0.0.0/8 private
  if (a === 10) return true
  // 172.16.0.0/12 private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16 link-local (含 AWS/GCP/Azure metadata 169.254.169.254)
  if (a === 169 && b === 254) return true
  // 100.64.0.0/10 CGNAT (carrier-grade NAT, 可能内部)
  if (a === 100 && b >= 64 && b <= 127) return true
  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  if (a >= 224) return true
  return false
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase()
  // ::1 loopback
  if (lower === '::1' || lower === '::') return true
  // fc00::/7 unique local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  // fe80::/10 link-local
  if (lower.startsWith('fe80:') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
  // IPv4-mapped (::ffff:127.0.0.1) —— extract v4 portion
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4mapped) return isPrivateIPv4(v4mapped[1])
  // IPv4-mapped HEX 形式 (::ffff:HHHH:HHHH) —— cr-fix 补，例：::ffff:7f00:1 = 127.0.0.1
  const v4mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16)
    const lo = parseInt(v4mappedHex[2], 16)
    const a = (hi >> 8) & 0xff
    const b = hi & 0xff
    const c = (lo >> 8) & 0xff
    const d = lo & 0xff
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`)
  }
  // IPv4-compatible (::a.b.c.d) deprecated 但还可能出现
  const v4compat = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/)
  if (v4compat) return isPrivateIPv4(v4compat[1])
  return false
}

/**
 * 给定一个 IP 字面（v4 或 v6），返回是否私网。
 * 不解析 hostname —— 调用方必须先 dns lookup 拿 IP。
 */
function isPrivateIPAddr(addr: string): boolean {
  const v = isIP(addr)
  if (v === 4) return isPrivateIPv4(addr)
  if (v === 6) return isPrivateIPv6(addr)
  return true // 不是合法 IP，保守拒
}

/**
 * 完整 SSRF 主校验（B3 修复）：dns.lookup 解析 hostname → 所有返回 IP 必须公网。
 * 处理所有 IP 字面变体（hex 0x7f000001 / decimal 2130706433 / short 127.1 / 等）—— 因为
 * dns.lookup 内部把这些 normalize 成 dotted-quad 再返回。
 *
 * 缺陷（接受）：DNS rebinding 在 fetch 实际打开 socket 那一瞬间 attacker 可以让 DNS
 * 返回不同 IP（与我们 lookup 的不一致）。完美防御要 dns.lookup 拿 IP → http.request
 * with explicit IP + Host header。当前架构用 fetch 不方便接管 socket，先实施 95% 防御。
 */
async function checkHostSafety(hostname: string): Promise<
  { ok: true; ips: string[] } | { ok: false; reason: string }
> {
  // 字面 IP 形式直接判
  if (isIP(hostname) > 0) {
    if (isPrivateIPAddr(hostname)) {
      return { ok: false, reason: `private IP literal: ${hostname}` }
    }
    return { ok: true, ips: [hostname] }
  }
  // 名字黑名单（内部 TLD 不要去 DNS resolve）
  if (hostname === 'localhost' || INTERNAL_TLD_REGEX.test(hostname)) {
    return { ok: false, reason: `internal hostname: ${hostname}` }
  }
  // DNS 解析所有地址
  let addrs: { address: string; family: number }[]
  try {
    addrs = await lookup(hostname, { all: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `DNS lookup failed: ${msg}` }
  }
  if (addrs.length === 0) {
    return { ok: false, reason: 'no DNS records' }
  }
  const ips = addrs.map((a) => a.address)
  for (const ip of ips) {
    if (isPrivateIPAddr(ip)) {
      return { ok: false, reason: `${hostname} resolves to private IP ${ip}` }
    }
  }
  return { ok: true, ips }
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

const MAX_FETCH_REDIRECTS = 5

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
  // SSRF (B3): dns.lookup + IP 私网校验 —— 覆盖 0x/dec/short/IPv4-mapped/CGNAT/链路本地等
  const initialHostCheck = await checkHostSafety(parsed.hostname)
  if (!initialHostCheck.ok) {
    await logToolAction({
      tool: 'fetch_url',
      argsSummary: `host=${parsed.hostname}`,
      result: 'denied',
      detail: `SSRF blocked: ${initialHostCheck.reason}`
    })
    return {
      ok: false,
      error: `禁止访问私网/本机地址: ${initialHostCheck.reason}（防 SSRF）`
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
  // 抓取（B3 修复：redirect:'manual' 手动跟 + 每跳重做 SSRF 校验防 302 到 metadata IP）
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_URL_TIMEOUT_MS)
  try {
    let currentUrl = parsed.toString()
    let resp: Response | null = null
    for (let redirects = 0; redirects <= MAX_FETCH_REDIRECTS; redirects++) {
      const currentParsed = new URL(currentUrl)
      // 非首次：重做 SSRF 校验（B3：302 redirect 到 169.254.169.254 类攻击）
      if (redirects > 0) {
        if (currentParsed.protocol !== 'http:' && currentParsed.protocol !== 'https:') {
          return {
            ok: false,
            error: `redirect 到非 http(s) scheme 已拒：${currentParsed.protocol}`
          }
        }
        const hopCheck = await checkHostSafety(currentParsed.hostname)
        if (!hopCheck.ok) {
          await logToolAction({
            tool: 'fetch_url',
            argsSummary: `redirect-host=${currentParsed.hostname}`,
            result: 'denied',
            detail: `redirect SSRF blocked: ${hopCheck.reason}`
          })
          return {
            ok: false,
            error: `redirect 到私网地址已拒：${hopCheck.reason}`
          }
        }
      }
      const r = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'DeskPet/0.1 (Electron; +https://github.com/Ice-teapop/desktop-pet)'
        }
      })
      // 3xx：手动跟
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location')
        if (!loc) {
          resp = r
          break
        }
        try {
          currentUrl = new URL(loc, currentUrl).toString()
        } catch {
          return { ok: false, error: `redirect Location 无效: ${loc}` }
        }
        continue
      }
      resp = r
      break
    }
    if (!resp) {
      return { ok: false, error: `redirect 链超过 ${MAX_FETCH_REDIRECTS} 跳` }
    }
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
    // cr-fix S1: 把抓到的网页内容包 untrusted 标签 + 标 host 供 AI 判断来源
    const finalHost = new URL(currentUrl).hostname
    if (contentType.startsWith('application/json')) {
      const txt = bytes.toString('utf8')
      let formatted = txt
      try {
        const obj = JSON.parse(txt)
        formatted = JSON.stringify(obj, null, 2)
      } catch {
        /* keep raw */
      }
      return {
        ok: true,
        content: wrapUntrusted(
          'fetch_url',
          { host: finalHost, content_type: 'json' },
          formatted.slice(0, FETCH_URL_MAX_CHARS)
        )
      }
    }
    if (contentType.startsWith('text/html')) {
      const html = bytes.toString('utf8')
      const text = htmlToText(html)
      return {
        ok: true,
        content: wrapUntrusted(
          'fetch_url',
          { host: finalHost, content_type: 'html' },
          text.slice(0, FETCH_URL_MAX_CHARS)
        )
      }
    }
    if (contentType.startsWith('text/')) {
      return {
        ok: true,
        content: wrapUntrusted(
          'fetch_url',
          { host: finalHost, content_type: contentType.split(';')[0] },
          bytes.toString('utf8').slice(0, FETCH_URL_MAX_CHARS)
        )
      }
    }
    return {
      ok: true,
      content: `(non-text content from ${finalHost}) Content-Type: ${contentType}, size: ${bytes.byteLength} bytes`
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
  // cr-fix: 用 execFile shell:false 改 argv —— 即使 domain/key 字符校验过仍多一层
  // 防 metachar 后门；env 用 safeChildEnv 跟 run_command 一致防泄漏
  const args = key ? ['read', domain, key] : ['read', domain]
  try {
    const { stdout } = await execFileAsync('defaults', args, {
      timeout: 5000,
      maxBuffer: 200_000,
      env: safeChildEnv(),
      shell: false
    })
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
