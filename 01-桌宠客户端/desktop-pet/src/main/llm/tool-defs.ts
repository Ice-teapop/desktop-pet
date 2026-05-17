/**
 * AI SDK Zod 化的 ToolSet 构造（M7-2）—— 给 llm-client.ts streamText 用。
 *
 * 跟 tools.ts 的分工：
 *  - tools.ts: 18 个 exec* 函数 + executeTool dispatcher + ToolDef 老定义 + ToolContext
 *  - tool-defs.ts（本文件）: Zod schema + AI SDK tool() helper + toModelOutput 适配
 *
 * description / behavior 不重复 —— 直接 import tools.ts 的 *_TOOL 取 description，
 * 路 executeTool 拿到完整 path-safety / approval / audit 链路（不复制逻辑）。
 *
 * 等 anthropic.ts 删除（wave 4），可以收掉 tools.ts 里的 ToolDef interface + 旧
 * input_schema 定义；本文件就是新的单一事实来源。
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  VIEW_SCREEN,
  READ_CLIPBOARD,
  OPEN_URL,
  COPY_TO_CLIPBOARD,
  CURRENT_APP_INFO,
  READ_FILE,
  LIST_DIRECTORY,
  RUN_COMMAND,
  OPEN_SYSTEM_SETTINGS,
  WRITE_FILE,
  CREATE_DIRECTORY,
  FIND_FILES,
  DELETE_FILE,
  SAVE_USER_PROFILE,
  REMEMBER,
  FETCH_URL,
  WEB_SEARCH,
  READ_SYSTEM_PREFERENCE,
  executeTool,
  type ToolContext,
  type ToolResultContent
} from './tools'

/**
 * 把 executeTool 的返回 ToolResultContent (string | ToolContentBlock[]) 转成 AI SDK 可见的
 * ToolResultOutput 形态（参见 @ai-sdk/provider-utils 的 ToolResultOutput union）。
 *
 * - 纯 string → { type: 'text', value }
 * - ToolContentBlock[] → { type: 'content', value: [...] } 其中 image source.base64 用
 *   { type: 'file-data', data, mediaType } 表示（'media' 已 deprecated）
 */
function toModelOutput({ output }: { output: ToolResultContent }) {
  if (typeof output === 'string') {
    return { type: 'text' as const, value: output }
  }
  return {
    type: 'content' as const,
    value: output.map((b) =>
      b.type === 'text'
        ? { type: 'text' as const, text: b.text }
        : {
            type: 'file-data' as const,
            data: b.source.data,
            mediaType: b.source.media_type
          }
    )
  }
}

/**
 * 通用 wrapper：包一个 tool() 用 executeTool dispatcher 跑 + 把 ToolResultContent 转 model output。
 *
 * - execute throw 会被 AI SDK 自动转成 tool-error content part（model 看得到 + 自然续答），
 *   所以我们 ok:false 时 throw（保留 error string 给 AI 解释原因）。
 * - inputSchema 用 zod —— 各 tool 的 schema 见下面 buildToolSetForContext 各分支。
 */
function wrapTool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  inputSchema: S,
  ctx: ToolContext
) {
  return tool({
    description,
    inputSchema,
    execute: async (input: z.infer<S>): Promise<ToolResultContent> => {
      const r = await executeTool(name, input, ctx)
      if (!r.ok) throw new Error(r.error)
      return r.content
    },
    toModelOutput
  })
}

// 系统设置 pane 的 enum —— 跟 tools.ts OPEN_SYSTEM_SETTINGS.input_schema.properties.pane.enum 对齐
const SETTINGS_PANES = [
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
] as const

const PERSONA_PRESETS = [
  'warm-friend',
  'professional',
  'witty-cold',
  'playful',
  'custom'
] as const

/**
 * 根据 ToolContext 动态构建 AI SDK ToolSet。
 * - tavilyApiKey=null → web_search 不暴露
 * - 后续 capability 扩展（用户没装 Anthropic 时 view_screen 限制等）也在这里 gate
 */
export function buildToolSetForContext(ctx: ToolContext): ToolSet {
  const tools: ToolSet = {
    view_screen: wrapTool('view_screen', VIEW_SCREEN.description, z.object({}), ctx),
    read_clipboard: wrapTool('read_clipboard', READ_CLIPBOARD.description, z.object({}), ctx),
    current_app_info: wrapTool(
      'current_app_info',
      CURRENT_APP_INFO.description,
      z.object({}),
      ctx
    ),
    open_url: wrapTool(
      'open_url',
      OPEN_URL.description,
      z.object({ url: z.string().describe('Fully-qualified http(s) URL') }),
      ctx
    ),
    copy_to_clipboard: wrapTool(
      'copy_to_clipboard',
      COPY_TO_CLIPBOARD.description,
      z.object({ text: z.string().describe('Text to write to the clipboard. Max 100,000 chars.') }),
      ctx
    ),
    read_file: wrapTool(
      'read_file',
      READ_FILE.description,
      z.object({ path: z.string().describe('Absolute or ~/-relative path to a text file') }),
      ctx
    ),
    list_directory: wrapTool(
      'list_directory',
      LIST_DIRECTORY.description,
      z.object({ path: z.string().describe('Absolute or ~/-relative directory path') }),
      ctx
    ),
    find_files: wrapTool(
      'find_files',
      FIND_FILES.description,
      z.object({
        root: z
          .string()
          .optional()
          .describe('Directory to search under (absolute or ~/-relative). Defaults to ~'),
        name_pattern: z
          .string()
          .describe(
            "Filename glob. Use * for any chars, ? for one char. Case-insensitive. " +
              "Examples: 'idea.md', '*.ts', 'notes-*'"
          )
      }),
      ctx
    ),
    write_file: wrapTool(
      'write_file',
      WRITE_FILE.description,
      z.object({
        path: z.string().describe('Absolute or ~/-relative path'),
        content: z.string().describe('Full UTF-8 text content to write. Max 1MB.')
      }),
      ctx
    ),
    create_directory: wrapTool(
      'create_directory',
      CREATE_DIRECTORY.description,
      z.object({ path: z.string().describe('Absolute or ~/-relative directory path') }),
      ctx
    ),
    delete_file: wrapTool(
      'delete_file',
      DELETE_FILE.description,
      z.object({ path: z.string().describe('Absolute or ~/-relative path to delete') }),
      ctx
    ),
    run_command: wrapTool(
      'run_command',
      RUN_COMMAND.description,
      z.object({
        command: z
          .string()
          .describe('Single-line shell command (no &&/;/|/> chaining preferred)'),
        cwd: z
          .string()
          .optional()
          .describe(
            "Working directory (optional, defaults to user's HOME). " +
              'Must be in a safe path; same safety rules as read_file apply.'
          )
      }),
      ctx
    ),
    open_system_settings: wrapTool(
      'open_system_settings',
      OPEN_SYSTEM_SETTINGS.description,
      z.object({ pane: z.enum(SETTINGS_PANES).describe('Settings pane identifier') }),
      ctx
    ),
    read_system_preference: wrapTool(
      'read_system_preference',
      READ_SYSTEM_PREFERENCE.description,
      z.object({
        domain: z
          .string()
          .describe(
            "Preference domain (e.g., 'com.apple.dock', 'NSGlobalDomain'). " +
              'Not all domains supported — sensitive ones are denied.'
          ),
        key: z
          .string()
          .optional()
          .describe('Optional specific key. If omitted, returns whole domain plist.')
      }),
      ctx
    ),
    fetch_url: wrapTool(
      'fetch_url',
      FETCH_URL.description,
      z.object({ url: z.string().describe('Public http(s) URL') }),
      ctx
    ),
    remember: wrapTool(
      'remember',
      REMEMBER.description,
      z.object({
        note: z
          .string()
          .describe(
            'A concise single-line fact to remember (max 500 chars). ' +
              "Format suggestion: state the fact, not the conversation context"
          )
      }),
      ctx
    ),
    save_user_profile: wrapTool(
      'save_user_profile',
      SAVE_USER_PROFILE.description,
      z.object({
        name: z.string().describe('How the user wants to be addressed (e.g., "Han")'),
        about: z
          .string()
          .describe(
            'Free-form 1-3 sentences summarizing their background: ' +
              'job / projects / tech stack / interests / habits as user told you'
          ),
        persona_preset: z
          .enum(PERSONA_PRESETS)
          .describe(
            "Pet persona style preset chosen by user. " +
              "warm-friend = warm casual; professional = direct technical; " +
              "witty-cold = sarcastic-but-helpful; playful = banter-heavy; " +
              "custom = no preset, use persona_custom only"
          ),
        persona_custom: z
          .string()
          .describe(
            'Optional user additions on top of the preset (or full description ' +
              'if preset=custom). Empty string if nothing extra.'
          )
      }),
      ctx
    )
  }

  // 仅当 Tavily key 存在时暴露 web_search
  if (ctx.tavilyApiKey) {
    tools.web_search = wrapTool(
      'web_search',
      WEB_SEARCH.description,
      z.object({
        query: z.string().describe('Search query in natural language'),
        max_results: z.string().optional().describe('Optional 1-10, defaults to 5')
      }),
      ctx
    )
  }

  return tools
}
