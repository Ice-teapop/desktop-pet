/**
 * Tool 显示标签 — 把 raw tool name (provider 命名空间前缀 + 下划线 + 行话)
 * 转成对用户友好的中文 + emoji.
 *
 * 跨 provider 同质能力归到同一显示（web_search / 联网搜索 / X 实时搜索 / Google
 * 搜索 / xAI 直链搜索 全部展示成"联网搜索 🌐"），让用户在 chat 里看到
 * 一致的"我在干嘛"提示，不被各家 native tool 名字差异搞迷糊。
 *
 * 用法（renderer）:
 *   getToolDisplay(toolName).label  → 显示在 msg-tool 卡 / pet-toast
 *   getToolDisplay(toolName).icon   → emoji 前缀
 *
 * 设计:
 *  - 用 startsWith / includes 子串匹配, 兼容 provider 各种命名 (anthropic_web_search,
 *    openai_web_search, xai_web_search, google_search 全归到一个 case)
 *  - 没匹配上 → 返回 raw name + 默认 🔧 (保底不报错)
 */

export interface ToolDisplay {
  label: string
  icon: string
}

const DEFAULT_ICON = '🔧'

/**
 * 把 raw tool name 转成 { label, icon }.
 * 永远返回, 不抛错; 没匹配上的返回 raw name + 🔧 默认图标.
 */
export function getToolDisplay(rawName: string): ToolDisplay {
  const name = rawName.toLowerCase()

  // —— web search 三套统一 ——
  // anthropic_web_search / openai_web_search / xai_web_search / web_search (Tavily)
  if (name.includes('web_search') || name.includes('websearch')) {
    return { label: '联网搜索', icon: '🌐' }
  }
  // xAI 独家: X 实时 feed
  if (name.includes('xai_live') || name.includes('live_search') || name.includes('x_search')) {
    return { label: 'X 实时搜索', icon: '𝕏' }
  }
  // Google search grounding
  if (name === 'google_search' || name.includes('google_search')) {
    return { label: 'Google 搜索', icon: '🌐' }
  }

  // —— code execution 跨 provider 统一 ——
  // anthropic_code_execution / openai_code_interpreter / 我们没本地实现
  if (name.includes('code_execution') || name.includes('code_interpreter')) {
    return { label: '代码执行', icon: '🐍' }
  }

  // —— URL / 网页内容 ——
  // fetch_url (本地) / google_url_context (server-side)
  if (name === 'fetch_url' || name.includes('url_context')) {
    return { label: '抓取网页', icon: '🔗' }
  }

  // —— 文件系统 ——
  if (name === 'read_file') return { label: '读文件', icon: '📄' }
  if (name === 'write_file') return { label: '写文件', icon: '✏️' }
  if (name === 'delete_file') return { label: '删文件', icon: '🗑' }
  if (name === 'move_file') return { label: '移动文件', icon: '📦' }
  if (name === 'list_directory') return { label: '列目录', icon: '📁' }
  if (name === 'find_files') return { label: '搜文件', icon: '🔎' }
  if (name === 'create_directory') return { label: '建目录', icon: '📁' }

  // —— 文档生成 ——
  if (name === 'write_docx') return { label: 'Word 文档', icon: '📝' }
  if (name === 'write_xlsx') return { label: 'Excel 表格', icon: '📊' }
  if (name === 'write_pdf') return { label: 'PDF 文档', icon: '📕' }

  // —— 系统 ——
  if (name === 'run_command') return { label: '终端', icon: '💻' }
  if (name === 'read_clipboard') return { label: '读剪贴板', icon: '📋' }
  if (name === 'copy_to_clipboard') return { label: '写剪贴板', icon: '📋' }
  if (name === 'open_url') return { label: '打开链接', icon: '🌐' }
  if (name === 'current_app_info') return { label: '查前台 App', icon: '🪟' }
  if (name === 'view_screen') return { label: '看屏幕', icon: '👁' }
  if (name === 'get_weather') return { label: '查天气', icon: '⛅' }
  if (name === 'read_system_preference') return { label: '系统设置', icon: '⚙️' }
  if (name === 'set_pet_animation') return { label: '桌宠动作', icon: '🎭' }

  return { label: rawName, icon: DEFAULT_ICON }
}
