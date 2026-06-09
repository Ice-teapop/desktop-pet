/**
 * Tool 显示标签 — 把 raw tool name (provider 命名空间前缀 + 下划线 + 行话)
 * 转成对用户友好的 label + emoji. label 走 i18n (zh/en).
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

import { t } from './i18n'

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
    return { label: t('tool_label.web_search'), icon: '🌐' }
  }
  // xAI 独家: X 实时 feed
  if (name.includes('xai_live') || name.includes('live_search') || name.includes('x_search')) {
    return { label: t('tool_label.x_search'), icon: '𝕏' }
  }
  // Google search grounding
  if (name === 'google_search' || name.includes('google_search')) {
    return { label: t('tool_label.google_search'), icon: '🌐' }
  }

  // —— code execution 跨 provider 统一 ——
  if (name.includes('code_execution') || name.includes('code_interpreter')) {
    return { label: t('tool_label.code_execution'), icon: '🐍' }
  }

  // —— URL / 网页内容 ——
  if (name === 'fetch_url' || name.includes('url_context')) {
    return { label: t('tool_label.fetch_url'), icon: '🔗' }
  }

  // —— 文件系统 ——
  if (name === 'read_file') return { label: t('tool_label.read_file'), icon: '📄' }
  if (name === 'write_file') return { label: t('tool_label.write_file'), icon: '✏️' }
  if (name === 'delete_file') return { label: t('tool_label.delete_file'), icon: '🗑' }
  if (name === 'move_file') return { label: t('tool_label.move_file'), icon: '📦' }
  if (name === 'copy_file') return { label: t('tool_label.copy_file'), icon: '📋' }
  if (name === 'organize_files') return { label: t('tool_label.organize_files'), icon: '🗂️' }
  if (name === 'list_directory') return { label: t('tool_label.list_directory'), icon: '📁' }
  if (name === 'find_files') return { label: t('tool_label.find_files'), icon: '🔎' }
  if (name === 'create_directory') return { label: t('tool_label.create_directory'), icon: '📁' }

  // —— 文档生成 ——
  if (name === 'write_docx') return { label: t('tool_label.write_docx'), icon: '📝' }
  if (name === 'write_xlsx') return { label: t('tool_label.write_xlsx'), icon: '📊' }
  if (name === 'write_pdf') return { label: t('tool_label.write_pdf'), icon: '📕' }

  // —— 系统 ——
  if (name === 'run_command') return { label: t('tool_label.run_command'), icon: '💻' }
  if (name === 'read_clipboard') return { label: t('tool_label.read_clipboard'), icon: '📋' }
  if (name === 'copy_to_clipboard') return { label: t('tool_label.copy_to_clipboard'), icon: '📋' }
  if (name === 'open_url') return { label: t('tool_label.open_url'), icon: '🌐' }
  if (name === 'current_app_info') return { label: t('tool_label.current_app_info'), icon: '🪟' }
  if (name === 'view_screen') return { label: t('tool_label.view_screen'), icon: '👁' }
  if (name === 'get_weather') return { label: t('tool_label.get_weather'), icon: '⛅' }
  if (name === 'read_system_preference')
    return { label: t('tool_label.read_system_preference'), icon: '⚙️' }
  if (name === 'set_pet_animation') return { label: t('tool_label.set_pet_animation'), icon: '🎭' }
  if (name === 'open_system_settings')
    return { label: t('tool_label.open_system_settings'), icon: '⚙️' }
  if (name === 'remember') return { label: t('tool_label.remember'), icon: '🧠' }
  if (name === 'load_skill') return { label: t('tool_label.load_skill'), icon: '✨' }
  if (name === 'save_user_profile') return { label: t('tool_label.save_user_profile'), icon: '🧠' }

  return { label: rawName, icon: DEFAULT_ICON }
}
