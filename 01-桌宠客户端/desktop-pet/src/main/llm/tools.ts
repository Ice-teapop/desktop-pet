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
import path from 'node:path'
import { promisify } from 'util'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { fetch as undiciFetch, Agent } from 'undici'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import PDFDocument from 'pdfkit'
import type { ActivityState } from '../../shared/chat-types'
import type { ApprovalDecision } from '../../shared/approval-types'
import { findModel, type SelectedModel } from '../../shared/provider-types'
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

/** LLM-agnostic Tool 定义 —— 用 JSON Schema input_schema 兼容 Anthropic / OpenAI / MCP
 *  Property 类型支持嵌套（array items / object properties），让 write_docx /
 *  write_xlsx 这类结构化 tool 能描述 sections / sheets 的内部 shape. */
export interface JsonSchemaProperty {
  type?: string | string[]
  description?: string
  enum?: (string | number)[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, JsonSchemaProperty>
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
   * M7-6 + M8 hotfix: 当前选定 model（含 provider + modelId）—— `specialized-tools.ts`
   * 据此决定 inject 哪些 provider 原生 server-side tool。
   *
   * 改成 full SelectedModel（不再只是 Provider）的原因：某些 native server tool
   * 只支持特定 model（e.g. Anthropic codeExecution_20260120 + webSearch_20260209
   * 都不支持 Haiku 4.5 —— 装上 Haiku 会让 API 直接拒绝 0 step 报"No output
   * generated"）。modelId 必须可见才能 gate。
   */
  selectedModel: SelectedModel
  /**
   * M8: AI 调 set_pet_animation tool 时由 main 端执行的回调 —— 把 stateMachine
   * transition 到对应 PetAnimation 状态（juggling/sweeping/conducting/...）+
   * scheduleReturnToIdle 动画播完后回 idle。executor 仅校验 enum + 调 callback。
   *
   * 返回 boolean: true=state 真的切了；false=被 minMs 保护或同 state no-op，
   * executor 据此返回 tool_result is_error=true 让 AI 知道这次调用没生效
   * （避免 AI 误以为 "ok" 但 user 看不到动画）。
   */
  setPetAnimation: (name: PetAnimation) => boolean
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
    'Call PROACTIVELY when the user message contains ANY of:\n' +
    '  (1) Explicit screen reference — "screen", "window", "this UI", "屏幕上", "这个窗口"\n' +
    '  (2) Ambiguous deixis without context — "this", "that", "here", "这是什么", "看看", ' +
    '"帮我看一下", "怎么样", "你觉得呢" when prior chat does not explain the reference\n' +
    '  (3) Question about user activity — "我在干什么", "what am I doing", ' +
    '"我在做什么", "在忙啥"\n' +
    '  (4) Problem report without pasted context — "这个 bug 怎么解决", ' +
    '"什么意思", "为什么这样", with no code/screenshot/error already in chat\n' +
    '  (5) Request for opinion/feedback on something unspecified visually\n' +
    'When in doubt for vision-adjacent ambiguous prompts → CALL. Cost is low, ' +
    "user explicitly enabled vision because they want you to look proactively.\n" +
    'DO NOT call for: pure math, jokes, your own nature, general world knowledge, ' +
    'or messages with explicit full context (long code paste, well-formed question with all info).',
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
    'BATCH: prefer `files: [{path, content}, ...]` for ≥2 files. Per-file modal ' +
    'still pops on untrusted paths but batch validates schema upfront and ' +
    'audit logs use a shared batch_id. Single-file `{path, content}` still accepted.' +
    'Returns confirmation with bytes written.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Single-file mode: absolute or ~/-relative path' },
      content: {
        type: 'string',
        description: 'Single-file mode: full UTF-8 text content. Max 1MB.'
      },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        },
        description: 'Batch mode: array of {path, content}. Each content up to 1MB.'
      }
    },
    required: []
  }
}

export const WRITE_DOCX: ToolDef = {
  name: 'write_docx',
  description:
    'Generate a Microsoft Word .docx document with title + sections. ' +
    "Use when user asks for 'Word 文档' / '报告' / '简历' / '合同' or wants " +
    'structured prose that needs typography. NOT for plain notes (use write_file .md). ' +
    'Each section optionally has a heading (level 1/2/3) and a list of paragraphs. ' +
    'Total paragraph text ≤ 100k chars per call. Same path safety as write_file. ' +
    'Returns confirmation with bytes written.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or ~/-relative path ending in .docx'
      },
      title: { type: 'string', description: 'Document title (rendered as H1 at top)' },
      sections: {
        type: 'array',
        description: 'Ordered sections. Empty array allowed if only title needed.',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string', description: 'Section heading text' },
            level: { type: 'number', enum: [1, 2, 3], description: 'Heading level (default 2)' },
            paragraphs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Body paragraphs under this section'
            }
          },
          required: ['paragraphs']
        }
      }
    },
    required: ['path', 'sections']
  }
}

export const WRITE_PDF: ToolDef = {
  name: 'write_pdf',
  description:
    'Generate a .pdf document with title + paragraphs (final-delivery, non-editable). ' +
    'Use when user wants 最终交付 / 不可编辑 / 多页排版 / "导出 PDF". ' +
    'NOT for editable docs (use write_docx) or tables (use write_xlsx). ' +
    'Supports Chinese via macOS system CJK fonts (Hiragino Sans GB / STHeiti / Songti). ' +
    'Total paragraph text ≤ 50k chars per call. Same path safety as write_file. ' +
    'Returns confirmation with bytes written.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or ~/-relative path ending in .pdf' },
      title: { type: 'string', description: 'Document title (rendered as large heading at top)' },
      paragraphs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Body paragraphs in order'
      },
      fontSize: { type: 'number', description: 'Body font size in pt (default 12)' }
    },
    required: ['path', 'paragraphs']
  }
}

export const WRITE_XLSX: ToolDef = {
  name: 'write_xlsx',
  description:
    'Generate a Microsoft Excel .xlsx workbook with one or more sheets. ' +
    'Use for tabular data / 财务 / 清单 / data exports. NOT for prose (use write_docx). ' +
    'Each sheet has a name + optional headers row + rows (string|number cells). ' +
    'Limits: ≤ 5000 rows per sheet, ≤ 2000 chars per cell. Same path safety as write_file. ' +
    'Returns confirmation with bytes written.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or ~/-relative path ending in .xlsx'
      },
      sheets: {
        type: 'array',
        description: 'At least one sheet required.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Sheet tab name' },
            headers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional header row (rendered bold)'
            },
            rows: {
              type: 'array',
              description: '2D array — each inner array is a row of cells (string or number)',
              items: { type: 'array', items: {} }
            }
          },
          required: ['name', 'rows']
        }
      }
    },
    required: ['path', 'sheets']
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
    'Move files / directories to the OS Trash (macOS Finder / Windows Recycle Bin / ' +
    "Linux freedesktop trash). Recoverable from the user's Trash UI until they empty it. " +
    'Still shows a confirmation modal (safety guardrail), but the modal wording reflects ' +
    'recoverability so the user is more willing to approve. ' +
    'NON-EMPTY DIRS are supported now (the entire tree goes to Trash). ' +
    'BATCH: prefer `paths: string[]` for ≥2 files — one modal lists all, single ' +
    'click approves whole batch (vs N modals if you call this tool N times in a loop, ' +
    'which races and most calls auto-deny). Legacy `path: string` still accepted for 1 file. ' +
    'If the OS Trash is unavailable (Linux headless / read-only volume / SMB mount), ' +
    'a second modal asks the user whether to fall back to permanent delete; never ' +
    'silently hard-deletes.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Single path (legacy/single-file; absolute or ~/-relative)'
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch paths (absolute or ~/-relative). Preferred for multi-file deletion.'
      }
    },
    // 二选一: 没法用 JSON Schema 直接表达 oneOf, 靠 zod refine 兜底 (tool-defs.ts)
    required: []
  }
}

export const MOVE_FILE: ToolDef = {
  name: 'move_file',
  description:
    'Move / rename a file or directory atomically. Use for organizing user files: ' +
    'sort Downloads by extension, batch rename, archive old files into dated folders, ' +
    'move screenshots into project subfolders, etc. ' +
    'TRUST: when ALL src + dest paths are inside the default-trusted scope (HOME ' +
    'visible top-level dirs: ~/Documents, ~/Downloads, ~/Desktop, ~/DeskPet, ~/Projects, ' +
    'etc.), runs silently — no modal. Only pops a modal when any src or dest is outside ' +
    'trusted scope. Same trust model as write_file. ' +
    'BATCH: prefer `moves: [{src, dest, overwrite?}, ...]` for ≥2 moves — one modal ' +
    'lists all src→dest pairs, single click approves whole batch (vs N modals if you ' +
    'call N times). Single-move `{src, dest, overwrite?}` still accepted. ' +
    'Safety: blacklist (~/.ssh / .aws / .env / Keychain etc) rejected; src + dest both ' +
    'go through path safety. Atomic fs.rename within same filesystem; falls back to ' +
    'copy + unlink across filesystems. Preserves binary content (跟 write_file 不同). ' +
    'Use `overwrite: true` (boolean, not string) only when user explicitly OKs replacement.',
  input_schema: {
    type: 'object',
    properties: {
      src: { type: 'string', description: 'Single-move: source path' },
      dest: {
        type: 'string',
        description:
          'Single-move: destination path. If trailing / or existing dir, src basename preserved.'
      },
      overwrite: {
        type: 'boolean',
        description: 'Single-move: true to allow overwriting existing dest. Default false.'
      },
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            src: { type: 'string' },
            dest: { type: 'string' },
            overwrite: { type: 'boolean' }
          },
          required: ['src', 'dest']
        },
        description: 'Batch mode: array of moves with optional per-item overwrite.'
      }
    },
    required: []
  }
}

export const COPY_FILE: ToolDef = {
  name: 'copy_file',
  description:
    'Copy a file or directory (src preserved). Mirror of move_file but src stays. ' +
    'Use for: duplicating templates, snapshotting before edit, copying screenshots ' +
    'into a project folder while keeping the original. ' +
    'TRUST: same as move_file — silent when all src + dest are in trusted scope; ' +
    'modal otherwise. ' +
    'BATCH: prefer `copies: [{src, dest, overwrite?}, ...]` for ≥2 copies. ' +
    'Single `{src, dest, overwrite?}` also accepted. ' +
    'Implementation: fs.cp({ recursive: true, force: overwrite }). Directories copied ' +
    'recursively. Preserves binary content. Use `overwrite: true` only when user OKs.',
  input_schema: {
    type: 'object',
    properties: {
      src: { type: 'string', description: 'Single-copy: source path' },
      dest: {
        type: 'string',
        description:
          'Single-copy: destination path. Trailing / or existing dir → src basename preserved.'
      },
      overwrite: {
        type: 'boolean',
        description: 'Single-copy: true to allow overwriting existing dest. Default false.'
      },
      copies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            src: { type: 'string' },
            dest: { type: 'string' },
            overwrite: { type: 'boolean' }
          },
          required: ['src', 'dest']
        },
        description: 'Batch mode: array of copies with optional per-item overwrite.'
      }
    },
    required: []
  }
}

export const ORGANIZE_FILES: ToolDef = {
  name: 'organize_files',
  description:
    'Macro: organize files matching a glob from one directory into another in ONE ' +
    'modal. Internally chains find_files → create_directory (dest, recursive) → ' +
    'batch move_file / copy_file. Use this instead of calling those 3 tools ' +
    'manually for tidying tasks: "sort Desktop screenshots into ~/Pictures/Screenshots/", ' +
    '"move all .pdf from Downloads to ~/Documents/inbox/", "copy all .png in ~/work/' +
    'to ~/backup/work/". One single modal lists every src→dest pair; one click ' +
    'approves the whole batch. Same trust rules as move_file/copy_file — silent ' +
    'when everything is in trusted scope. ' +
    'pattern is a filename glob (* / ?), case-insensitive. ' +
    'action: "move" (src removed) or "copy" (src kept).',
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Source directory (absolute or ~/-relative). Searched recursively.'
      },
      to: {
        type: 'string',
        description:
          'Destination directory (absolute or ~/-relative). Created with mkdir -p if needed.'
      },
      pattern: {
        type: 'string',
        description:
          "Filename glob. Examples: '*.png', 'Screen Shot *.png', '*.pdf'. " +
          "Defaults to '*' (everything). Case-insensitive."
      },
      action: {
        type: 'string',
        enum: ['move', 'copy'],
        description: 'move (src removed) or copy (src preserved). Default move.'
      },
      overwrite: {
        type: 'boolean',
        description: 'Allow overwriting existing dest files. Default false.'
      }
    },
    required: ['from', 'to']
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
    `  • juggling     —— juggling balls / multi-tasking / handling several things\n` +
    `  • sweeping     —— tidying / cleaning / organizing\n` +
    `  • conducting   —— waving baton / keeping rhythm / music conducting\n` +
    `  • grooving     —— headphones bopping / listening / enjoying rhythm\n` +
    `  • celebrating  —— happy / celebrate / task done / thanks\n` +
    `  • carrying     —— hauling / moving items / helping organize / "我帮你拿过来"\n` +
    `  • ultrathink   —— deep reasoning pose (Opus adaptive thinking style, static)`,
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

export const GET_WEATHER: ToolDef = {
  name: 'get_weather',
  description:
    'REAL-TIME weather lookup for a city. **MUST CALL** when user mentions weather, ' +
    'temperature, rain, snow, "天气", "多少度", "下雨", "热不热", "weather", or asks ' +
    'about outdoor activities where weather matters (爬山/picnic/出门). ' +
    'NEVER guess. NEVER say "API is unavailable" or "weather service down" — ' +
    'just call this tool. Provider: Open-Meteo (always available, no key needed). ' +
    'Returns current temperature (°C), apparent temp, humidity, wind, condition (中文), ' +
    'day/night flag, plus 12 hourly forecast points (covers user questions about ' +
    'rest of day or tomorrow morning).',
  input_schema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description:
          'City / region name in any language. Examples: "北京", "Beijing", "New York", ' +
          '"San Francisco, CA", "Tokyo", "Melbourne". If user did not specify a city, ' +
          'ASK them which city before calling — do not guess location.'
      }
    },
    required: ['location']
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
        type: 'number',
        description: 'Optional integer 1-10, defaults to 5'
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
  WRITE_DOCX,
  WRITE_XLSX,
  WRITE_PDF,
  CREATE_DIRECTORY,
  FIND_FILES,
  DELETE_FILE,
  MOVE_FILE,
  RUN_COMMAND,
  OPEN_SYSTEM_SETTINGS,
  READ_SYSTEM_PREFERENCE,
  FETCH_URL,
  GET_WEATHER,
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
      return await execReadFile(input, ctx)
    case 'list_directory':
      return await execListDirectory(input)
    case 'write_file':
      return await execWriteFile(input)
    case 'write_docx':
      return await execWriteDocx(input)
    case 'write_xlsx':
      return await execWriteXlsx(input)
    case 'write_pdf':
      return await execWritePdf(input)
    case 'create_directory':
      return await execCreateDirectory(input)
    case 'find_files':
      return await execFindFiles(input)
    case 'delete_file':
      return await execDeleteFile(input)
    case 'move_file':
      return await execMoveFile(input)
    case 'copy_file':
      return await execCopyFile(input)
    case 'organize_files':
      return await execOrganizeFiles(input)
    case 'run_command':
      return await execRunCommand(input)
    case 'open_system_settings':
      return await execOpenSystemSettings(input)
    case 'read_system_preference':
      return await execReadSystemPreference(input)
    case 'fetch_url':
      return await execFetchUrl(input)
    case 'get_weather':
      return await execGetWeather(input)
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
  // M8 cr-fix: 看 transition 返回值。如果上一次 animation 还在 minMs 保护期内，
  // setPetAnimation 返 false → AI 看到 is_error 知道这次没生效，可以选择
  // 等当前动画完再 retry，或者直接放弃。不返 ok 防止 AI 误以为播了实际没播。
  const ok = ctx.setPetAnimation(name)
  if (!ok) {
    return {
      ok: false,
      error:
        `Animation '${name}' was blocked —— 上一个动画还在 minMs 保护期内（` +
        `2-3.5s），或者当前已经是 ${name}。等一会儿再调，或者跳过这次表演直接` +
        `回文本响应。`
    }
  }
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

async function execReadFile(input: unknown, ctx: ToolContext): Promise<ToolResult> {
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
    // v0.4.3+ fix: 先嗅探前 8KB 检测二进制 — PDF / docx / xlsx / 图片等当 utf8
    // 读会返回一坨 replacement char + 几百万字符撑爆 token. 二进制直接拒, 给 AI
    // 可行的下一步 (用 path 当引用 / 提议安装解析器 / 让用户复制粘贴文字).
    const SNIFF_BYTES = 8192
    const sniffBuf = Buffer.alloc(Math.min(SNIFF_BYTES, stat.size))
    const fh = await fs.open(gate.absPath, 'r')
    const { bytesRead } = await fh.read(sniffBuf, 0, sniffBuf.length, 0)
    await fh.close()
    const sniff = sniffBuf.subarray(0, bytesRead)
    // null byte 在文本文件极少 (除非 UTF-16 BOM 后的 ASCII 第一字节 == 0; 但
    // 我们没声明支持 UTF-16). 任何 null byte 视为二进制.
    const hasNull = sniff.includes(0)
    // PDF / ZIP-based office docs (docx/xlsx/pptx) / 图片 magic bytes 检测
    const magicHex = sniff.subarray(0, 8).toString('hex')
    const isPdf = sniff.subarray(0, 4).toString() === '%PDF'
    const isZipOffice = magicHex.startsWith('504b0304') // ZIP magic — docx/xlsx/pptx
    const isPng = magicHex.startsWith('89504e470d0a1a0a')
    const isJpeg = magicHex.startsWith('ffd8ff')
    const isGif = magicHex.startsWith('474946383')
    const isWebp =
      magicHex.startsWith('52494646') && sniff.subarray(8, 12).toString() === 'WEBP'
    // v0.4.3+ 二进制按类型 dispatch 到对应 parser (替代之前的"一律拒"):
    //  - PDF        → pdf-parse 提取文本
    //  - DOCX       → mammoth 提取 raw text (剥 XML 标签)
    //  - XLSX       → exceljs 读 sheets → CSV-style 文本
    //  - PPTX       → 没装 parser, 仍 reject
    //  - 图片        → 模型 supportsVision 时返回 ToolContentBlock image; 否则 reject
    //  - 其他 null-byte 二进制 → reject (未知格式)
    const ext = path.extname(gate.absPath).toLowerCase().slice(1)
    if (isPdf || ext === 'pdf') {
      const parser = new PDFParse({ data: await fs.readFile(gate.absPath) })
      try {
        const result = await parser.getText()
        const totalChars = result.text.length
        const truncated = totalChars > READ_FILE_MAX
        const body = truncated ? result.text.slice(0, READ_FILE_MAX) : result.text
        const header = `[PDF 解析: ${result.pages.length} 页, ${totalChars} 字符${truncated ? ` (截断到 ${READ_FILE_MAX})` : ''}]\n\n`
        return {
          ok: true,
          content: wrapUntrusted('file', { path: gate.absPath }, header + body)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `PDF 解析失败: ${msg}` }
      } finally {
        await parser.destroy().catch(() => {})
      }
    }
    if (isZipOffice && ext === 'docx') {
      try {
        const result = await mammoth.extractRawText({ path: gate.absPath })
        const totalChars = result.value.length
        const truncated = totalChars > READ_FILE_MAX
        const body = truncated ? result.value.slice(0, READ_FILE_MAX) : result.value
        const warnings = result.messages
          .filter((m) => m.type === 'warning')
          .slice(0, 3)
          .map((m) => m.message)
        const header = `[DOCX 解析: ${totalChars} 字符${truncated ? ` (截断到 ${READ_FILE_MAX})` : ''}${warnings.length ? `, ${warnings.length} 警告` : ''}]\n\n`
        return {
          ok: true,
          content: wrapUntrusted('file', { path: gate.absPath }, header + body)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `DOCX 解析失败: ${msg}` }
      }
    }
    if (isZipOffice && ext === 'xlsx') {
      try {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.readFile(gate.absPath)
        const sheetLines: string[] = []
        let totalCells = 0
        wb.worksheets.forEach((ws) => {
          sheetLines.push(`## Sheet: ${ws.name} (${ws.rowCount} rows × ${ws.columnCount} cols)`)
          ws.eachRow({ includeEmpty: false }, (row) => {
            const cells: string[] = []
            row.eachCell({ includeEmpty: false }, (cell) => {
              const v = cell.value
              cells.push(v == null ? '' : String(v))
              totalCells++
            })
            if (cells.length > 0) sheetLines.push(cells.join('\t'))
          })
          sheetLines.push('')
        })
        const fullText = sheetLines.join('\n')
        const truncated = fullText.length > READ_FILE_MAX
        const body = truncated ? fullText.slice(0, READ_FILE_MAX) : fullText
        const header = `[XLSX 解析: ${wb.worksheets.length} sheet(s), ${totalCells} 非空 cell${truncated ? `, 截断到 ${READ_FILE_MAX} 字符` : ''}]\n\n`
        return {
          ok: true,
          content: wrapUntrusted('file', { path: gate.absPath }, header + body)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `XLSX 解析失败: ${msg}` }
      }
    }
    if (isZipOffice && ext === 'pptx') {
      return {
        ok: false,
        error: `PPTX 当前没装 parser (pptx2json 等). 请用户截图发过来 (vision tool) 或复制粘贴关键文字.`
      }
    }
    if (isPng || isJpeg || isGif || isWebp) {
      const cap = findModel(ctx.selectedModel)
      if (!cap?.supportsVision) {
        return {
          ok: false,
          error: `当前 model (${ctx.selectedModel.provider}/${ctx.selectedModel.modelId}) 不支持 vision input. 切换到 supports-vision model (如 Claude / GPT-4o / Gemini) 后再调.`
        }
      }
      try {
        const buf = await fs.readFile(gate.absPath)
        // Anthropic image_block 上限 5MB encoded; base64 体积 +33% → raw cap ~3.75MB
        const MAX_IMG_RAW = 3.5 * 1024 * 1024
        if (buf.length > MAX_IMG_RAW) {
          return {
            ok: false,
            error: `图片太大 (${(buf.length / 1024 / 1024).toFixed(1)}MB > 3.5MB raw / ~5MB base64 上限). 让用户压缩或裁切.`
          }
        }
        const mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' =
          isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isGif ? 'image/gif' : 'image/webp'
        return {
          ok: true,
          content: [
            { type: 'text', text: `[图片: ${gate.absPath} (${(buf.length / 1024).toFixed(0)}KB ${mediaType})]` },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } }
          ]
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `图片读取失败: ${msg}` }
      }
    }
    if (hasNull) {
      return {
        ok: false,
        error: `未知二进制格式 (.${ext}), 不可读取. 让用户告知文件类型 + 自处理.`
      }
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

/** 单批 write 上限 —— 防 LLM 一次塞 100 文件把 modal 队列撑爆 */
const WRITE_BATCH_MAX = 30

async function execWriteFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path, content } or { files: [...] }' }
  }
  // 归一化: 单文件 → files[0]
  const obj = input as { path?: unknown; content?: unknown; files?: unknown }
  const items: { path: string; content: string }[] = []
  if (typeof obj.path === 'string' && typeof obj.content === 'string') {
    items.push({ path: obj.path, content: obj.content })
  }
  if (Array.isArray(obj.files)) {
    for (let i = 0; i < obj.files.length; i++) {
      const f = obj.files[i]
      if (typeof f !== 'object' || f === null) {
        return { ok: false, error: `files[${i}] must be an object` }
      }
      const fo = f as { path?: unknown; content?: unknown }
      if (typeof fo.path !== 'string') {
        return { ok: false, error: `files[${i}].path must be a string` }
      }
      if (typeof fo.content !== 'string') {
        return { ok: false, error: `files[${i}].content must be a string` }
      }
      items.push({ path: fo.path, content: fo.content })
    }
  }
  if (items.length === 0) {
    return {
      ok: false,
      error: 'must provide {path, content} (single) or non-empty files[] (batch)'
    }
  }
  if (items.length > WRITE_BATCH_MAX) {
    return {
      ok: false,
      error: `batch too large (${items.length} > ${WRITE_BATCH_MAX}). Split.`
    }
  }
  // 每个 file 内容上限
  for (let i = 0; i < items.length; i++) {
    if (items[i].content.length > WRITE_FILE_MAX) {
      return {
        ok: false,
        error: `files[${i}] content too long: ${items[i].content.length} > ${WRITE_FILE_MAX}`
      }
    }
  }

  // 单文件: 走原 requestPathApprovalWithPreview 保留 content preview UX
  if (items.length === 1) {
    const it = items[0]
    const gate = await requestPathApprovalWithPreview(
      it.path,
      'write_file',
      '写入文件',
      it.content.slice(0, 200)
    )
    if (!gate.ok) return gate
    try {
      await fs.writeFile(gate.absPath, it.content, { encoding: 'utf8', mode: 0o644 })
      return { ok: true, content: `Wrote ${it.content.length} chars to ${gate.absPath}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `writeFile failed: ${msg}` }
    }
  }

  // 批量: 先所有 path 过 safety + trust 检查, 收集 untrusted 列表, 单次 modal
  const batchId = `wr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const resolved: { absPath: string; content: string; needsApproval: boolean }[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const safety = await isPathSafe(it.path)
    if (!safety.ok) {
      await logToolAction({
        tool: 'write_file',
        argsSummary: `batch_id=${batchId} blacklisted=${it.path}`,
        result: 'denied',
        detail: `blacklist: ${safety.reason ?? 'unknown'}`
      })
      return { ok: false, error: `files[${i}] 路径被黑名单拦 (整批拒): ${it.path} (${safety.reason})` }
    }
    const trust = checkTrusted(safety.absPath)
    resolved.push({ absPath: safety.absPath, content: it.content, needsApproval: !trust })
  }
  const untrusted = resolved.filter((r) => r.needsApproval).map((r) => r.absPath)
  if (untrusted.length > 0) {
    // 一次 modal 列出所有 untrusted 路径
    const decision = await requestApproval({
      tool: 'write_file',
      summary: `📝 AI 想批量写入 ${resolved.length} 个文件（${untrusted.length} 个需授权）`,
      paths: untrusted
    })
    if (decision === 'deny') {
      await logToolAction({
        tool: 'write_file',
        argsSummary: `batch_id=${batchId} count=${resolved.length} untrusted=${untrusted.length}`,
        result: 'denied',
        detail: 'user denied batch'
      })
      return { ok: false, error: '用户拒绝整批写入' }
    }
  }
  // best-effort 写入
  const written: { path: string; bytes: number }[] = []
  const failed: { path: string; err: string }[] = []
  for (const r of resolved) {
    try {
      await fs.writeFile(r.absPath, r.content, { encoding: 'utf8', mode: 0o644 })
      written.push({ path: r.absPath, bytes: r.content.length })
      await logToolAction({
        tool: 'write_file',
        argsSummary: `batch_id=${batchId} path=${r.absPath}`,
        result: 'ok',
        detail: `bytes=${r.content.length}${r.needsApproval ? ' (approved)' : ' (trusted)'}`
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ path: r.absPath, err: msg })
      await logToolAction({
        tool: 'write_file',
        argsSummary: `batch_id=${batchId} path=${r.absPath}`,
        result: 'error',
        detail: msg
      })
    }
  }
  await logToolAction({
    tool: 'write_file',
    argsSummary: `batch_id=${batchId} summary count=${resolved.length}`,
    result: failed.length === 0 ? 'ok' : 'error',
    detail: `wrote=${written.length} failed=${failed.length}`
  })
  if (failed.length === 0) {
    return {
      ok: true,
      content:
        `Wrote ${written.length} files:\n` +
        written.map((w) => `${w.path} (${w.bytes} chars)`).join('\n')
    }
  }
  return {
    ok: true,
    content:
      `Wrote ${written.length}/${resolved.length}.\n` +
      (written.length > 0
        ? `OK:\n${written.map((w) => `${w.path} (${w.bytes})`).join('\n')}\n`
        : '') +
      `Failed:\n${failed.map((f) => `${f.path}: ${f.err}`).join('\n')}`
  }
}

// —— write_docx / write_xlsx —— Microsoft Office 二进制格式 ————————————————
// 跟 write_file 共用 requestPathApprovalWithPreview (audit log 自动记录).

const WRITE_DOCX_MAX_CHARS = 100_000 // 全 sections paragraphs 字符总和上限
const WRITE_XLSX_MAX_ROWS = 5_000 // 单 sheet 行上限
const WRITE_XLSX_MAX_CELL_CHARS = 2_000 // 单 cell 字符上限

function headingLevelFromInt(n: number | undefined): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  // default level 2 (H2); 1/2/3 映射 HEADING_1/2/3
  if (n === 1) return HeadingLevel.HEADING_1
  if (n === 3) return HeadingLevel.HEADING_3
  return HeadingLevel.HEADING_2
}

async function execWriteDocx(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path, title?, sections: [...] }' }
  }
  const obj = input as { path?: unknown; title?: unknown; sections?: unknown }
  if (typeof obj.path !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  if (!Array.isArray(obj.sections)) {
    return { ok: false, error: 'sections must be an array' }
  }
  // 校验 sections + 计字符总数
  type SectionIn = { heading?: string; level?: number; paragraphs: string[] }
  const sections: SectionIn[] = []
  let totalChars = 0
  for (let i = 0; i < obj.sections.length; i++) {
    const raw = obj.sections[i]
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `sections[${i}] must be an object` }
    }
    const s = raw as { heading?: unknown; level?: unknown; paragraphs?: unknown }
    if (!Array.isArray(s.paragraphs)) {
      return { ok: false, error: `sections[${i}].paragraphs must be an array of strings` }
    }
    const paragraphs: string[] = []
    for (let j = 0; j < s.paragraphs.length; j++) {
      const p = s.paragraphs[j]
      if (typeof p !== 'string') {
        return { ok: false, error: `sections[${i}].paragraphs[${j}] must be a string` }
      }
      totalChars += p.length
      paragraphs.push(p)
    }
    if (s.heading !== undefined && typeof s.heading !== 'string') {
      return { ok: false, error: `sections[${i}].heading must be a string` }
    }
    if (s.level !== undefined && ![1, 2, 3].includes(s.level as number)) {
      return { ok: false, error: `sections[${i}].level must be 1, 2, or 3` }
    }
    if (s.heading) totalChars += (s.heading as string).length
    sections.push({
      heading: s.heading as string | undefined,
      level: s.level as number | undefined,
      paragraphs
    })
  }
  const title = typeof obj.title === 'string' ? obj.title : undefined
  if (title) totalChars += title.length
  if (totalChars > WRITE_DOCX_MAX_CHARS) {
    return {
      ok: false,
      error: `docx text too long: ${totalChars} > ${WRITE_DOCX_MAX_CHARS} chars. Split into multiple files.`
    }
  }
  // 路径审批（写盘前）
  const previewBits: string[] = []
  if (title) previewBits.push(title)
  if (sections[0]?.heading) previewBits.push(sections[0].heading)
  if (sections[0]?.paragraphs[0]) previewBits.push(sections[0].paragraphs[0])
  const gate = await requestPathApprovalWithPreview(
    obj.path,
    'write_docx',
    '写 Word 文档',
    previewBits.join(' · ').slice(0, 200)
  )
  if (!gate.ok) return gate
  // 构 docx
  const children: Paragraph[] = []
  if (title) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 36 })],
        heading: HeadingLevel.TITLE
      })
    )
  }
  for (const s of sections) {
    if (s.heading) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: s.heading, bold: true })],
          heading: headingLevelFromInt(s.level)
        })
      )
    }
    for (const p of s.paragraphs) {
      children.push(new Paragraph({ children: [new TextRun(p)] }))
    }
  }
  try {
    const doc = new Document({ sections: [{ children }] })
    const buffer = await Packer.toBuffer(doc)
    await fs.writeFile(gate.absPath, buffer, { mode: 0o644 })
    return {
      ok: true,
      content: `Wrote ${buffer.length} bytes (.docx, ${sections.length} sections, ${totalChars} chars) to ${gate.absPath}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `生成 docx 失败: ${msg}` }
  }
}

async function execWriteXlsx(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path, sheets: [...] }' }
  }
  const obj = input as { path?: unknown; sheets?: unknown }
  if (typeof obj.path !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  if (!Array.isArray(obj.sheets) || obj.sheets.length === 0) {
    return { ok: false, error: 'sheets must be a non-empty array' }
  }
  // 校验 sheets
  type SheetIn = { name: string; headers?: string[]; rows: (string | number)[][] }
  const sheets: SheetIn[] = []
  for (let i = 0; i < obj.sheets.length; i++) {
    const raw = obj.sheets[i]
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `sheets[${i}] must be an object` }
    }
    const s = raw as { name?: unknown; headers?: unknown; rows?: unknown }
    if (typeof s.name !== 'string' || !s.name) {
      return { ok: false, error: `sheets[${i}].name must be a non-empty string` }
    }
    if (!Array.isArray(s.rows)) {
      return { ok: false, error: `sheets[${i}].rows must be an array` }
    }
    if (s.rows.length > WRITE_XLSX_MAX_ROWS) {
      return {
        ok: false,
        error: `sheets[${i}] has ${s.rows.length} rows, max ${WRITE_XLSX_MAX_ROWS}. Split into multiple sheets/files.`
      }
    }
    const rows: (string | number)[][] = []
    for (let j = 0; j < s.rows.length; j++) {
      const row = s.rows[j]
      if (!Array.isArray(row)) {
        return { ok: false, error: `sheets[${i}].rows[${j}] must be an array` }
      }
      const cells: (string | number)[] = []
      for (let k = 0; k < row.length; k++) {
        const cell = row[k]
        if (typeof cell === 'string') {
          if (cell.length > WRITE_XLSX_MAX_CELL_CHARS) {
            return {
              ok: false,
              error: `sheets[${i}].rows[${j}][${k}] cell too long: ${cell.length} > ${WRITE_XLSX_MAX_CELL_CHARS} chars`
            }
          }
          cells.push(cell)
        } else if (typeof cell === 'number') {
          cells.push(cell)
        } else {
          return {
            ok: false,
            error: `sheets[${i}].rows[${j}][${k}] must be string or number, got ${typeof cell}`
          }
        }
      }
      rows.push(cells)
    }
    let headers: string[] | undefined
    if (s.headers !== undefined) {
      if (!Array.isArray(s.headers)) {
        return { ok: false, error: `sheets[${i}].headers must be an array of strings` }
      }
      headers = []
      for (let h = 0; h < s.headers.length; h++) {
        const v = s.headers[h]
        if (typeof v !== 'string') {
          return { ok: false, error: `sheets[${i}].headers[${h}] must be a string` }
        }
        headers.push(v)
      }
    }
    sheets.push({ name: s.name, headers, rows })
  }
  // 路径审批（写盘前）
  const previewBits: string[] = []
  for (const s of sheets) {
    previewBits.push(s.name + ` (${s.rows.length} rows)`)
    if (previewBits.length >= 3) break
  }
  const gate = await requestPathApprovalWithPreview(
    obj.path,
    'write_xlsx',
    '写 Excel 表格',
    previewBits.join(' · ').slice(0, 200)
  )
  if (!gate.ok) return gate
  try {
    const wb = new ExcelJS.Workbook()
    let totalRows = 0
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name)
      if (s.headers) {
        const row = ws.addRow(s.headers)
        row.font = { bold: true }
      }
      for (const cells of s.rows) {
        ws.addRow(cells)
        totalRows++
      }
    }
    const buffer = await wb.xlsx.writeBuffer()
    await fs.writeFile(gate.absPath, Buffer.from(buffer), { mode: 0o644 })
    return {
      ok: true,
      content: `Wrote ${buffer.byteLength} bytes (.xlsx, ${sheets.length} sheets, ${totalRows} rows) to ${gate.absPath}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `生成 xlsx 失败: ${msg}` }
  }
}

// —— write_pdf —— PDF via pdfkit + macOS 系统 CJK 字体 ————————————————————

const WRITE_PDF_MAX_CHARS = 50_000

// 候选 CJK 字体 (file path + face family name). pdfkit 用 fontkit 支持 .ttc；
// 必须提供 face name 否则取 default face 可能不含中文。按 macOS 通用度排序，
// 第一个能加载成功的用. 都不行 → 退 Helvetica + ASCII-only.
const CJK_FONT_CANDIDATES: ReadonlyArray<readonly [string, string]> = [
  ['/System/Library/Fonts/PingFang.ttc', 'PingFangSC-Regular'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'HiraginoSansGB-W3'],
  ['/System/Library/Fonts/STHeiti Medium.ttc', 'STHeitiSC-Medium'],
  ['/System/Library/Fonts/STHeiti Light.ttc', 'STHeitiSC-Light'],
  ['/System/Library/Fonts/Supplemental/Songti.ttc', 'STSongti-SC-Regular']
] as const

function containsCjk(s: string): boolean {
  // CJK Unified Ideographs + 扩展 + 常用全角标点
  return /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/.test(s)
}

async function execWritePdf(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path, title?, paragraphs: [...], fontSize? }' }
  }
  const obj = input as {
    path?: unknown
    title?: unknown
    paragraphs?: unknown
    fontSize?: unknown
  }
  if (typeof obj.path !== 'string') {
    return { ok: false, error: 'path must be a string' }
  }
  if (!Array.isArray(obj.paragraphs)) {
    return { ok: false, error: 'paragraphs must be an array of strings' }
  }
  const paragraphs: string[] = []
  let totalChars = 0
  for (let i = 0; i < obj.paragraphs.length; i++) {
    const p = obj.paragraphs[i]
    if (typeof p !== 'string') {
      return { ok: false, error: `paragraphs[${i}] must be a string` }
    }
    paragraphs.push(p)
    totalChars += p.length
  }
  const title = typeof obj.title === 'string' ? obj.title : undefined
  if (title) totalChars += title.length
  if (totalChars > WRITE_PDF_MAX_CHARS) {
    return {
      ok: false,
      error: `pdf text too long: ${totalChars} > ${WRITE_PDF_MAX_CHARS} chars. Split into multiple files.`
    }
  }
  const fontSize = typeof obj.fontSize === 'number' && obj.fontSize >= 6 && obj.fontSize <= 72
    ? obj.fontSize
    : 12
  // 内容含中文? 决定是否必须 CJK font
  const needCjk = (title && containsCjk(title)) || paragraphs.some(containsCjk)
  // 路径审批
  const preview = (title ?? paragraphs[0] ?? '(empty pdf)').slice(0, 200)
  const gate = await requestPathApprovalWithPreview(
    obj.path,
    'write_pdf',
    '写 PDF 文档',
    preview
  )
  if (!gate.ok) return gate
  try {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    // 注册 CJK 字体（按候选顺序尝试，第一个成功的用）
    let cjkFontRegistered: string | null = null
    for (const [file, face] of CJK_FONT_CANDIDATES) {
      try {
        await fs.access(file)
        doc.registerFont('CJK', file, face)
        cjkFontRegistered = file
        break
      } catch {
        // try next
      }
    }
    if (needCjk && !cjkFontRegistered) {
      return {
        ok: false,
        error: '内容含中文但系统找不到 CJK 字体 (PingFang/Hiragino/STHeiti/Songti 都没装). 用 write_docx 代替.'
      }
    }
    // collect chunks → buffer
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })
    const bodyFont = cjkFontRegistered ? 'CJK' : 'Helvetica'
    if (title) {
      doc.font(bodyFont).fontSize(fontSize * 1.8).text(title, { align: 'center' })
      doc.moveDown(1.2)
    }
    doc.font(bodyFont).fontSize(fontSize)
    for (const p of paragraphs) {
      doc.text(p, { align: 'left', lineGap: 4 })
      doc.moveDown(0.6)
    }
    doc.end()
    const buffer = await done
    await fs.writeFile(gate.absPath, buffer, { mode: 0o644 })
    return {
      ok: true,
      content: `Wrote ${buffer.length} bytes (.pdf, ${paragraphs.length} paragraphs, ${totalChars} chars${cjkFontRegistered ? `, CJK font: ${cjkFontRegistered.split('/').pop()}` : ', ASCII only'}) to ${gate.absPath}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `生成 pdf 失败: ${msg}` }
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

/** 单批 delete 上限 —— 防 LLM 一次提交几百 path 把 modal 撑爆 */
const DELETE_BATCH_MAX = 50

async function execDeleteFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { path } or { paths: [] }' }
  }
  // 归一化：path (string) 或 paths (string[]) → rawPaths: string[]
  const obj = input as { path?: unknown; paths?: unknown }
  const rawPaths: string[] = []
  if (typeof obj.path === 'string') rawPaths.push(obj.path)
  if (Array.isArray(obj.paths)) {
    for (const p of obj.paths) {
      if (typeof p === 'string') rawPaths.push(p)
    }
  }
  if (rawPaths.length === 0) {
    return { ok: false, error: 'must provide `path` (string) or `paths` (string[])' }
  }
  if (rawPaths.length > DELETE_BATCH_MAX) {
    return {
      ok: false,
      error: `batch too large (${rawPaths.length} > ${DELETE_BATCH_MAX}). Split into multiple calls.`
    }
  }

  // path safety: per-path 检查, 任一命中黑名单 → fail-fast 整批拒
  // 理由 (审核官员 pre-review): 黑名单命中 = AI 试图碰凭证, 是高信号攻击迹象,
  // 跳过继续等于把警报降级成 warning, 也丢失 "AI 试图删 N 个里有 1 个禁区" 的审计可追溯性
  const safetyResults = await Promise.all(rawPaths.map((p) => isPathSafe(p)))
  const blacklistHits = safetyResults
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.ok)
  if (blacklistHits.length > 0) {
    for (const { s, i } of blacklistHits) {
      await logToolAction({
        tool: 'delete_file',
        argsSummary: `blacklisted=${rawPaths[i]}`,
        result: 'denied',
        detail: `blacklist: ${s.reason ?? 'unknown'}`
      })
    }
    return {
      ok: false,
      error:
        `路径被静态黑名单拦截 (整批拒绝): ` +
        blacklistHits.map(({ s, i }) => `${rawPaths[i]} (${s.reason})`).join('; ')
    }
  }
  const safePaths = safetyResults.map((s) => (s as { absPath: string }).absPath)

  // 单次 modal: paths[] 列全部, paths.length>1 时 renderer 自动隐藏 trust-dir-*
  const isBatch = safePaths.length > 1
  const summary = isBatch
    ? `🗑 AI 想把 ${safePaths.length} 个路径移到废纸篓（可在 Finder 恢复）`
    : `🗑 AI 想把这个移到废纸篓：${safePaths[0]}（可在 Finder 恢复）`
  const decision = await requestApproval({
    tool: 'delete_file',
    summary,
    // 单 path 走旧字段, 批量走新字段; renderer 据此切 UI
    ...(isBatch ? { paths: safePaths } : { path: safePaths[0] })
  })
  // batch_id: 关联同一批的 N+1 行审计 log
  const batchId = `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  if (decision === 'deny') {
    await logToolAction({
      tool: 'delete_file',
      argsSummary: `batch_id=${batchId} count=${safePaths.length}`,
      result: 'denied',
      detail: `user denied; paths=${safePaths.join(',')}`
    })
    return { ok: false, error: isBatch ? '用户拒绝整批移到废纸篓' : '用户拒绝移到废纸篓' }
  }

  // best-effort continue: 一条挂不影响后续 (审核官员 pre-review #4: 短路 abort
  // 会让用户已批准的剩余操作丢失, 用户疲劳重批)
  //
  // v0.4.16 起删除走 shell.trashItem (macOS Finder Trash / Win Recycle / Linux gio trash).
  // 非空目录现也支持 —— OS 把整树挪进 trash, 不再 ENOTEMPTY 阻塞.
  // trashItem throw → 不静默 fall-through 到 fs.unlink (那会破坏"可恢复"承诺), 改弹
  // fallback modal 让 user 选 "永久删除 / 取消" (cr review must-have).
  const trashed: string[] = []
  const failed: { path: string; err: string }[] = []
  const hardDeleted: string[] = [] // user 在 fallback modal 选了真删的
  for (const absPath of safePaths) {
    try {
      await shell.trashItem(absPath)
      trashed.push(absPath)
      await logToolAction({
        tool: 'delete_file',
        argsSummary: `batch_id=${batchId} path=${absPath}`,
        result: 'ok',
        detail: `trashed; approved: ${decision}`
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // trash 不可用 (Linux headless / 只读卷 / SMB / 权限) → fallback modal 让 user 选
      const fallbackDecision = await requestApproval({
        tool: 'delete_file',
        summary:
          `⚠️ 废纸篓不可用 —— ${absPath}\n` +
          `原因: ${msg}\n` +
          `是否改为永久删除？(不可恢复)`,
        path: absPath
      })
      if (fallbackDecision === 'deny') {
        failed.push({ path: absPath, err: `trash unavailable + user denied hard-delete: ${msg}` })
        await logToolAction({
          tool: 'delete_file',
          argsSummary: `batch_id=${batchId} path=${absPath}`,
          result: 'denied',
          detail: `trash failed (${msg}); user denied fallback hard-delete`
        })
        continue
      }
      // user allowed hard-delete fallback
      try {
        const stat = await fs.stat(absPath)
        if (stat.isDirectory()) {
          await fs.rm(absPath, { recursive: true, force: true })
        } else {
          await fs.unlink(absPath)
        }
        hardDeleted.push(absPath)
        await logToolAction({
          tool: 'delete_file',
          argsSummary: `batch_id=${batchId} path=${absPath}`,
          result: 'ok',
          detail: `hard-deleted (trash fallback); trash err: ${msg}; user approved fallback`
        })
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        failed.push({ path: absPath, err: `trash failed (${msg}); hard-delete also failed: ${msg2}` })
        await logToolAction({
          tool: 'delete_file',
          argsSummary: `batch_id=${batchId} path=${absPath}`,
          result: 'error',
          detail: `trash failed (${msg}); hard-delete failed (${msg2})`
        })
      }
    }
  }
  // summary log (审核官员 pre-review #5: 1 行 summary + N 行 per-path)
  await logToolAction({
    tool: 'delete_file',
    argsSummary: `batch_id=${batchId} summary count=${safePaths.length}`,
    result: failed.length === 0 ? 'ok' : 'error',
    detail:
      `trashed=${trashed.length} hard_deleted=${hardDeleted.length} ` +
      `failed=${failed.length} approval=${decision}`
  })

  // 结构化结果: AI 看 content 决定是否对失败项 follow-up
  const okCount = trashed.length + hardDeleted.length
  const buildOkLines = (): string => {
    const lines: string[] = []
    if (trashed.length > 0) lines.push(`Trashed (recoverable):\n${trashed.join('\n')}`)
    if (hardDeleted.length > 0) lines.push(`Hard-deleted (trash unavailable):\n${hardDeleted.join('\n')}`)
    return lines.join('\n')
  }
  if (failed.length === 0) {
    return {
      ok: true,
      content: isBatch
        ? `Removed ${okCount} paths.\n${buildOkLines()}`
        : trashed.length > 0
          ? `Trashed: ${trashed[0]} (recoverable in Finder Trash)`
          : `Hard-deleted: ${hardDeleted[0]} (trash unavailable)`
    }
  }
  return {
    ok: true,
    content:
      `Removed ${okCount}/${safePaths.length}.\n` +
      (okCount > 0 ? `${buildOkLines()}\n` : '') +
      `Failed:\n${failed.map((f) => `${f.path}: ${f.err}`).join('\n')}`
  }
}

// —— move_file —— 移动 / 重命名 文件或目录 (跟 delete 同 modal 级别) ————————————

const MOVE_BATCH_MAX = 50

/** 解析一个 move pair → { srcAbs, destAbs } 或错误 */
async function resolveMovePair(
  rawSrc: string,
  rawDest: string,
  overwrite: boolean
): Promise<
  | { ok: true; srcAbs: string; finalDest: string }
  | { ok: false; error: string }
> {
  const srcSafety = await isPathSafe(rawSrc)
  if (!srcSafety.ok) return { ok: false, error: `src 黑名单拦: ${srcSafety.reason}` }
  const destSafety = await isPathSafe(rawDest)
  if (!destSafety.ok) return { ok: false, error: `dest 黑名单拦: ${destSafety.reason}` }
  let finalDest = destSafety.absPath
  try {
    const destStat = await fs.stat(destSafety.absPath).catch(() => null)
    if (destStat?.isDirectory() || rawDest.endsWith('/')) {
      const srcBasename = srcSafety.absPath.split('/').pop() ?? ''
      finalDest = destSafety.absPath.replace(/\/+$/, '') + '/' + srcBasename
    }
    if (!overwrite) {
      const finalStat = await fs.stat(finalDest).catch(() => null)
      if (finalStat) {
        return {
          ok: false,
          error: `dest 已存在 (${finalDest})。需 overwrite:true (boolean)`
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `检查 dest 失败: ${msg}` }
  }
  return { ok: true, srcAbs: srcSafety.absPath, finalDest }
}

/** 实际执行一个 move (假设已 approve, 已 resolve) */
async function doMove(
  srcAbs: string,
  finalDest: string,
  overwrite: boolean
): Promise<{ ok: true; msg: string } | { ok: false; err: string }> {
  // 确保 dest 父目录存在
  try {
    const destParent = finalDest.substring(0, finalDest.lastIndexOf('/'))
    if (destParent) await fs.mkdir(destParent, { recursive: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, err: `创建 dest 父目录失败: ${msg}` }
  }
  try {
    await fs.rename(srcAbs, finalDest)
    return { ok: true, msg: `Moved: ${srcAbs} → ${finalDest}` }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'EXDEV') return { ok: false, err: `rename failed: ${e.message}` }
    // 跨 fs fallback
    try {
      await fs.cp(srcAbs, finalDest, { recursive: true, force: overwrite })
      await fs.rm(srcAbs, { recursive: true, force: true })
      return { ok: true, msg: `Moved (cross-fs): ${srcAbs} → ${finalDest}` }
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2)
      return { ok: false, err: `cross-fs move failed: ${msg}` }
    }
  }
}

async function execMoveFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { src, dest, overwrite? } or { moves: [...] }' }
  }
  const obj = input as {
    src?: unknown
    dest?: unknown
    overwrite?: unknown
    moves?: unknown
  }
  // 归一化
  type MoveItem = { src: string; dest: string; overwrite: boolean }
  const items: MoveItem[] = []
  if (typeof obj.src === 'string' && typeof obj.dest === 'string') {
    // overwrite 接受 boolean (新 schema) 或 "true" string (老格式向后兼容)
    const ow = obj.overwrite === true || obj.overwrite === 'true'
    items.push({ src: obj.src, dest: obj.dest, overwrite: ow })
  }
  if (Array.isArray(obj.moves)) {
    for (let i = 0; i < obj.moves.length; i++) {
      const m = obj.moves[i]
      if (typeof m !== 'object' || m === null) {
        return { ok: false, error: `moves[${i}] must be an object` }
      }
      const mo = m as { src?: unknown; dest?: unknown; overwrite?: unknown }
      if (typeof mo.src !== 'string') return { ok: false, error: `moves[${i}].src must be string` }
      if (typeof mo.dest !== 'string') return { ok: false, error: `moves[${i}].dest must be string` }
      const ow = mo.overwrite === true || mo.overwrite === 'true'
      items.push({ src: mo.src, dest: mo.dest, overwrite: ow })
    }
  }
  if (items.length === 0) {
    return { ok: false, error: 'must provide {src, dest} or non-empty moves[]' }
  }
  if (items.length > MOVE_BATCH_MAX) {
    return { ok: false, error: `batch too large (${items.length} > ${MOVE_BATCH_MAX}). Split.` }
  }

  // 解析所有 pair, 黑名单 / dest 已存在等 fail-fast 整批拒
  const resolved: { srcAbs: string; finalDest: string; overwrite: boolean }[] = []
  for (let i = 0; i < items.length; i++) {
    const r = await resolveMovePair(items[i].src, items[i].dest, items[i].overwrite)
    if (!r.ok) return { ok: false, error: `moves[${i}] (整批拒): ${r.error}` }
    resolved.push({ srcAbs: r.srcAbs, finalDest: r.finalDest, overwrite: items[i].overwrite })
  }
  const isBatch = resolved.length > 1

  // v0.4.16: move 享受 trust scope —— 所有 src + dest 都在 default/session/persistent
  // trusted scope 内则静默执行 (跟 write_file 一致). 任一不在则弹 modal 全批一起批准.
  // 理由: 之前 "move 不享受信任" 是过度保守 —— write 都信任了, move 是 write+delete
  // 复合, 等价信任级别. user 报告"多轮才能完成"的主要根因就是 move 强弹 modal.
  const batchId = `mv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const allTrusted = resolved.every(
    (r) => checkTrusted(r.srcAbs) && checkTrusted(r.finalDest)
  )
  let decision: ApprovalDecision = 'allow-once'
  if (allTrusted) {
    await logToolAction({
      tool: 'move_file',
      argsSummary: `batch_id=${batchId} count=${resolved.length}`,
      result: 'auto-trusted',
      detail: `all src+dest in trusted scope`
    })
  } else {
    const summary = isBatch
      ? `📦 AI 想批量移动 ${resolved.length} 个 src→dest`
      : `📦 AI 想移动:\n${resolved[0].srcAbs}\n  ↓\n${resolved[0].finalDest}${resolved[0].overwrite ? '\n(将覆盖)' : ''}`
    decision = await requestApproval({
      tool: 'move_file',
      summary,
      ...(isBatch
        ? { paths: resolved.map((r) => `${r.srcAbs} → ${r.finalDest}`) }
        : { path: resolved[0].srcAbs })
    })
    if (decision === 'deny') {
      await logToolAction({
        tool: 'move_file',
        argsSummary: `batch_id=${batchId} count=${resolved.length}`,
        result: 'denied',
        detail: 'user denied'
      })
      return { ok: false, error: isBatch ? '用户拒绝整批移动' : '用户拒绝移动' }
    }
  }

  // best-effort
  const moved: string[] = []
  const failed: { pair: string; err: string }[] = []
  for (const r of resolved) {
    const res = await doMove(r.srcAbs, r.finalDest, r.overwrite)
    const pair = `${r.srcAbs} → ${r.finalDest}`
    if (res.ok) {
      moved.push(res.msg)
      await logToolAction({
        tool: 'move_file',
        argsSummary: `batch_id=${batchId} src=${r.srcAbs} dest=${r.finalDest}`,
        result: 'ok',
        detail: `approved: ${decision}${r.overwrite ? ' overwrite' : ''}`
      })
    } else {
      failed.push({ pair, err: res.err })
      await logToolAction({
        tool: 'move_file',
        argsSummary: `batch_id=${batchId} src=${r.srcAbs} dest=${r.finalDest}`,
        result: 'error',
        detail: res.err
      })
    }
  }
  await logToolAction({
    tool: 'move_file',
    argsSummary: `batch_id=${batchId} summary count=${resolved.length}`,
    result: failed.length === 0 ? 'ok' : 'error',
    detail: `moved=${moved.length} failed=${failed.length}`
  })
  if (failed.length === 0) {
    return { ok: true, content: isBatch ? `Moved ${moved.length}:\n${moved.join('\n')}` : moved[0] }
  }
  return {
    ok: true,
    content:
      `Moved ${moved.length}/${resolved.length}.\n` +
      (moved.length > 0 ? `OK:\n${moved.join('\n')}\n` : '') +
      `Failed:\n${failed.map((f) => `${f.pair}: ${f.err}`).join('\n')}`
  }
}

// —— copy_file —— 复制文件/目录 (move 的镜像 + src 保留) ————————————————————

const COPY_BATCH_MAX = 50

async function doCopy(
  srcAbs: string,
  finalDest: string,
  overwrite: boolean
): Promise<{ ok: true; msg: string } | { ok: false; err: string }> {
  try {
    const destParent = finalDest.substring(0, finalDest.lastIndexOf('/'))
    if (destParent) await fs.mkdir(destParent, { recursive: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, err: `创建 dest 父目录失败: ${msg}` }
  }
  try {
    await fs.cp(srcAbs, finalDest, { recursive: true, force: overwrite })
    return { ok: true, msg: `Copied: ${srcAbs} → ${finalDest}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, err: `copy failed: ${msg}` }
  }
}

async function execCopyFile(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { src, dest, overwrite? } or { copies: [...] }' }
  }
  const obj = input as {
    src?: unknown
    dest?: unknown
    overwrite?: unknown
    copies?: unknown
  }
  type CopyItem = { src: string; dest: string; overwrite: boolean }
  const items: CopyItem[] = []
  if (typeof obj.src === 'string' && typeof obj.dest === 'string') {
    const ow = obj.overwrite === true || obj.overwrite === 'true'
    items.push({ src: obj.src, dest: obj.dest, overwrite: ow })
  }
  if (Array.isArray(obj.copies)) {
    for (let i = 0; i < obj.copies.length; i++) {
      const c = obj.copies[i]
      if (typeof c !== 'object' || c === null) {
        return { ok: false, error: `copies[${i}] must be an object` }
      }
      const co = c as { src?: unknown; dest?: unknown; overwrite?: unknown }
      if (typeof co.src !== 'string') return { ok: false, error: `copies[${i}].src must be string` }
      if (typeof co.dest !== 'string') return { ok: false, error: `copies[${i}].dest must be string` }
      const ow = co.overwrite === true || co.overwrite === 'true'
      items.push({ src: co.src, dest: co.dest, overwrite: ow })
    }
  }
  if (items.length === 0) {
    return { ok: false, error: 'must provide {src, dest} or non-empty copies[]' }
  }
  if (items.length > COPY_BATCH_MAX) {
    return { ok: false, error: `batch too large (${items.length} > ${COPY_BATCH_MAX}). Split.` }
  }
  // 复用 resolveMovePair 做 path-safety + dest 解析 + overwrite 检查 (语义对 copy 也对)
  const resolved: { srcAbs: string; finalDest: string; overwrite: boolean }[] = []
  for (let i = 0; i < items.length; i++) {
    const r = await resolveMovePair(items[i].src, items[i].dest, items[i].overwrite)
    if (!r.ok) return { ok: false, error: `copies[${i}] (整批拒): ${r.error}` }
    resolved.push({ srcAbs: r.srcAbs, finalDest: r.finalDest, overwrite: items[i].overwrite })
  }
  const isBatch = resolved.length > 1
  const batchId = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  // trust scope 内静默 (同 move_file)
  const allTrusted = resolved.every(
    (r) => checkTrusted(r.srcAbs) && checkTrusted(r.finalDest)
  )
  let decision: ApprovalDecision = 'allow-once'
  if (allTrusted) {
    await logToolAction({
      tool: 'copy_file',
      argsSummary: `batch_id=${batchId} count=${resolved.length}`,
      result: 'auto-trusted',
      detail: 'all src+dest in trusted scope'
    })
  } else {
    const summary = isBatch
      ? `📋 AI 想批量复制 ${resolved.length} 个 src→dest`
      : `📋 AI 想复制:\n${resolved[0].srcAbs}\n  ↓\n${resolved[0].finalDest}${resolved[0].overwrite ? '\n(将覆盖)' : ''}`
    decision = await requestApproval({
      tool: 'copy_file',
      summary,
      ...(isBatch
        ? { paths: resolved.map((r) => `${r.srcAbs} → ${r.finalDest}`) }
        : { path: resolved[0].srcAbs })
    })
    if (decision === 'deny') {
      await logToolAction({
        tool: 'copy_file',
        argsSummary: `batch_id=${batchId} count=${resolved.length}`,
        result: 'denied',
        detail: 'user denied'
      })
      return { ok: false, error: isBatch ? '用户拒绝整批复制' : '用户拒绝复制' }
    }
  }
  const copied: string[] = []
  const failed: { pair: string; err: string }[] = []
  for (const r of resolved) {
    const res = await doCopy(r.srcAbs, r.finalDest, r.overwrite)
    const pair = `${r.srcAbs} → ${r.finalDest}`
    if (res.ok) {
      copied.push(res.msg)
      await logToolAction({
        tool: 'copy_file',
        argsSummary: `batch_id=${batchId} src=${r.srcAbs} dest=${r.finalDest}`,
        result: 'ok',
        detail: `approved: ${decision}${r.overwrite ? ' overwrite' : ''}`
      })
    } else {
      failed.push({ pair, err: res.err })
      await logToolAction({
        tool: 'copy_file',
        argsSummary: `batch_id=${batchId} src=${r.srcAbs} dest=${r.finalDest}`,
        result: 'error',
        detail: res.err
      })
    }
  }
  await logToolAction({
    tool: 'copy_file',
    argsSummary: `batch_id=${batchId} summary count=${resolved.length}`,
    result: failed.length === 0 ? 'ok' : 'error',
    detail: `copied=${copied.length} failed=${failed.length}`
  })
  if (failed.length === 0) {
    return { ok: true, content: isBatch ? `Copied ${copied.length}:\n${copied.join('\n')}` : copied[0] }
  }
  return {
    ok: true,
    content:
      `Copied ${copied.length}/${resolved.length}.\n` +
      (copied.length > 0 ? `OK:\n${copied.join('\n')}\n` : '') +
      `Failed:\n${failed.map((f) => `${f.pair}: ${f.err}`).join('\n')}`
  }
}

// —— organize_files —— macro: find + mkdir + batch move/copy 一气呵成 ——————————

const ORGANIZE_MAX_MATCHES = 50

async function execOrganizeFiles(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { from, to, pattern?, action?, overwrite? }' }
  }
  const obj = input as {
    from?: unknown
    to?: unknown
    pattern?: unknown
    action?: unknown
    overwrite?: unknown
  }
  if (typeof obj.from !== 'string' || !obj.from) {
    return { ok: false, error: '`from` (string) required' }
  }
  if (typeof obj.to !== 'string' || !obj.to) {
    return { ok: false, error: '`to` (string) required' }
  }
  const pattern = typeof obj.pattern === 'string' && obj.pattern ? obj.pattern : '*'
  const action = obj.action === 'copy' ? 'copy' : 'move' // 默认 move
  const overwrite = obj.overwrite === true

  // Step 1: 解析 from / to + path-safety
  const fromSafety = await isPathSafe(obj.from)
  if (!fromSafety.ok) return { ok: false, error: `from 不安全: ${fromSafety.reason}` }
  const toSafety = await isPathSafe(obj.to)
  if (!toSafety.ok) return { ok: false, error: `to 不安全: ${toSafety.reason}` }
  // from 必须存在且是目录
  try {
    const fromStat = await fs.stat(fromSafety.absPath)
    if (!fromStat.isDirectory()) {
      return { ok: false, error: `from 不是目录: ${fromSafety.absPath}` }
    }
  } catch {
    return { ok: false, error: `from 不存在: ${fromSafety.absPath}` }
  }

  // Step 2: 用 globToRegex + walk (复用 find_files 的逻辑骨架) 找匹配文件
  // 不走 find_files exec 是因为我们要拿 absolute path 而不是 string list
  const re = globToRegex(pattern)
  const matches: string[] = []
  const FIND_TIMEOUT_MS = 5000
  const startTime = Date.now()
  let entriesScanned = 0
  let aborted = false
  async function walk(dir: string, depthLeft: number): Promise<void> {
    if (aborted || depthLeft < 0 || matches.length >= ORGANIZE_MAX_MATCHES) return
    if (Date.now() - startTime > FIND_TIMEOUT_MS) {
      aborted = true
      return
    }
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (aborted || matches.length >= ORGANIZE_MAX_MATCHES) return
      entriesScanned++
      if (e.name.startsWith('.') && e.name !== '.') continue
      if (e.isDirectory() && FIND_FILES_SKIP_DIRS.has(e.name)) continue
      const full = dir + '/' + e.name
      if (e.isFile() && re.test(e.name)) {
        const safety = await isPathSafe(full)
        if (safety.ok) matches.push(safety.absPath)
      }
      if (e.isDirectory()) await walk(full, depthLeft - 1)
    }
  }
  await walk(fromSafety.absPath, 6)

  if (matches.length === 0) {
    return {
      ok: true,
      content: `No files matching "${pattern}" under ${fromSafety.absPath}. Nothing to organize.`
    }
  }
  if (matches.length >= ORGANIZE_MAX_MATCHES) {
    return {
      ok: false,
      error:
        `Too many matches (≥${ORGANIZE_MAX_MATCHES}). Narrow pattern or split into batches ` +
        `via direct move_file/copy_file.`
    }
  }

  // Step 3: build pair list (dest = to + basename)
  const toBase = toSafety.absPath.replace(/\/+$/, '')
  const pairs = matches.map((src) => {
    const basename = src.split('/').pop() ?? ''
    return { src, dest: `${toBase}/${basename}`, overwrite }
  })

  // Step 4: dispatch 给 copy or move (它们自带 trust 检查 + 单 modal + audit)
  const dispatchInput =
    action === 'copy'
      ? { copies: pairs.map((p) => ({ src: p.src, dest: p.dest, overwrite })) }
      : { moves: pairs.map((p) => ({ src: p.src, dest: p.dest, overwrite })) }

  await logToolAction({
    tool: 'organize_files',
    argsSummary: `from=${fromSafety.absPath} to=${toBase} pattern=${pattern} action=${action} count=${pairs.length}`,
    result: 'ok',
    detail: `dispatched to ${action === 'copy' ? 'copy_file' : 'move_file'}; matches=${matches.length} scanned=${entriesScanned}`
  })

  return action === 'copy' ? await execCopyFile(dispatchInput) : await execMoveFile(dispatchInput)
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

// —— get_weather —— Open-Meteo 免费 API 不需 key —————————————————————————

const WEATHER_TIMEOUT_MS = 10_000

// 强制 IPv4 dialing. Node undici 默认 IPv6-first (Happy Eyeballs), macOS 偶发场景
// 下 IPv6 dial 失败 + IPv4 fallback 时序长 → AggregateError ETIMEDOUT. open-meteo.com
// IPv4 实测在 macOS curl 下 1.3s 通; fetch 用 IPv4-only agent 绕开 Happy Eyeballs 坑.
// 仅给 weather call 用 (其它 fetch 走默认 dispatcher 不影响).
const weatherIpv4Agent = new Agent({
  connect: { family: 4, timeout: WEATHER_TIMEOUT_MS }
})

// WMO weather code → 中文描述. 参 https://open-meteo.com/en/docs#weather_variable_documentation
function wmoCodeToCn(code: number): string {
  const map: Record<number, string> = {
    0: '晴',
    1: '少云',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '冻雾',
    51: '小毛毛雨',
    53: '中毛毛雨',
    55: '大毛毛雨',
    56: '小冻毛毛雨',
    57: '大冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '小冻雨',
    67: '大冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '雪粒',
    80: '小阵雨',
    81: '中阵雨',
    82: '大阵雨',
    85: '小阵雪',
    86: '大阵雪',
    95: '雷暴',
    96: '雷暴+小冰雹',
    99: '雷暴+大冰雹'
  }
  return map[code] ?? `未知天气 (code ${code})`
}

interface GeocodingResult {
  results?: Array<{
    latitude: number
    longitude: number
    name: string
    admin1?: string
    country?: string
    timezone?: string
  }>
}

interface ForecastResult {
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    weather_code: number
    is_day: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    weather_code: number[]
  }
  timezone: string
}

async function execGetWeather(input: unknown): Promise<ToolResult> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { location: string }' }
  }
  const obj = input as { location?: unknown }
  if (typeof obj.location !== 'string' || !obj.location.trim()) {
    return { ok: false, error: 'location must be a non-empty string' }
  }
  const location = obj.location.trim()
  console.log(`[get_weather] location="${location}" — start`)
  await logToolAction({
    tool: 'get_weather',
    argsSummary: `location=${location}`,
    result: 'ok',
    detail: 'open-meteo (no key)'
  })
  try {
    // 1. Geocoding —— 把 city name 转 lat/lng
    const geoUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}` +
      `&count=1&language=zh&format=json`
    console.log(`[get_weather] GET ${geoUrl}`)
    const geoResp = await undiciFetch(geoUrl, {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
      dispatcher: weatherIpv4Agent
    })
    if (!geoResp.ok) {
      console.warn(`[get_weather] geocoding HTTP ${geoResp.status}`)
      return { ok: false, error: `geocoding HTTP ${geoResp.status}: 服务暂不可用，告知用户稍后再试` }
    }
    const geoJson = (await geoResp.json()) as GeocodingResult
    if (!geoJson.results || geoJson.results.length === 0) {
      console.log(`[get_weather] no geocoding result for "${location}"`)
      return { ok: false, error: `没找到城市 "${location}"，换个名字试 (e.g. "Beijing" / "北京市")` }
    }
    const place = geoJson.results[0]
    console.log(
      `[get_weather] geocoded "${location}" → ${place.name} (${place.latitude}, ${place.longitude})`
    )

    // 2. Forecast
    const fcastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
      `&hourly=temperature_2m,weather_code&forecast_days=2&timezone=auto`
    const fcastResp = await undiciFetch(fcastUrl, {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
      dispatcher: weatherIpv4Agent
    })
    if (!fcastResp.ok) {
      console.warn(`[get_weather] forecast HTTP ${fcastResp.status}`)
      return { ok: false, error: `forecast HTTP ${fcastResp.status}: 服务暂不可用` }
    }
    const fc = (await fcastResp.json()) as ForecastResult
    console.log(`[get_weather] OK ${place.name} ${fc.current.temperature_2m}°C`)

    // 3. Format
    const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ')
    const cur = fc.current
    const lines = [
      `📍 ${placeName} (${fc.timezone})`,
      `当前: ${wmoCodeToCn(cur.weather_code)} ${cur.temperature_2m}°C (体感 ${cur.apparent_temperature}°C)`,
      `湿度 ${cur.relative_humidity_2m}% · 风速 ${cur.wind_speed_10m} km/h · ${cur.is_day ? '☀️ 白天' : '🌙 夜晚'}`,
      '',
      '未来 12 小时:'
    ]
    const now = new Date()
    // hourly time 是从今天 00:00 起每小时一条; 找到当前时刻附近的索引取 12 条
    const nowMs = now.getTime()
    let startIdx = 0
    for (let i = 0; i < fc.hourly.time.length; i++) {
      if (new Date(fc.hourly.time[i]).getTime() >= nowMs) {
        startIdx = i
        break
      }
    }
    const endIdx = Math.min(startIdx + 12, fc.hourly.time.length)
    for (let i = startIdx; i < endIdx; i++) {
      const t = new Date(fc.hourly.time[i])
      const hh = t.getHours().toString().padStart(2, '0')
      lines.push(
        `  ${hh}:00  ${wmoCodeToCn(fc.hourly.weather_code[i])} ${fc.hourly.temperature_2m[i]}°C`
      )
    }
    return { ok: true, content: lines.join('\n') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    console.error(`[get_weather] error: ${msg}`, err)
    return {
      ok: false,
      error: isTimeout
        ? `获取天气超时 (>${WEATHER_TIMEOUT_MS}ms). 网络慢或 Open-Meteo 不可达, 告知用户稍后再试.`
        : `获取天气失败: ${msg}`
    }
  }
}

async function execWebSearch(input: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tavilyApiKey) {
    return { ok: false, error: 'Tavily API key 未配置 —— 设置 TAVILY_API_KEY 环境变量或在设置面板填' }
  }
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'input must be { query: string, max_results?: number }' }
  }
  const obj = input as { query?: unknown; max_results?: unknown }
  if (typeof obj.query !== 'string' || !obj.query.trim()) {
    return { ok: false, error: 'query required' }
  }
  let maxResults = 5
  // schema 已要 number, 但兼容旧版 LLM 学到的 string 传参
  if (typeof obj.max_results === 'number') {
    if (Number.isFinite(obj.max_results) && obj.max_results >= 1 && obj.max_results <= 10) {
      maxResults = Math.floor(obj.max_results)
    }
  } else if (typeof obj.max_results === 'string') {
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
