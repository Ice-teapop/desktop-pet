/**
 * English string dictionary — must mirror zh.ts shape (TS enforces via I18nDict).
 *
 * If you add a new key, add it to zh.ts first (source of truth), then mirror here.
 * Missing-key compile error tells you what to fill in.
 */

import type { I18nDict } from './zh'

export const en: I18nDict = {
  // —— Tray menu ——
  'tray.show_hide': 'Show / Hide pet',
  'tray.reset_position': 'Reset position (bottom-right)',
  'tray.mini_mode': 'Mini mode (tuck to edge)',
  'tray.vision': 'Screen awareness (let AI see)',
  'tray.activity_label': 'Activity: {0} {1}',
  'tray.activity_disabled': 'Activity: (not tracking)',
  'tray.follow_front_app': 'Follow front app',
  'tray.strict_llm': 'Strict LLM classify (disable fast-path)',
  'tray.settings': 'Settings…',
  'tray.reset_key': 'Reset API key…',
  'tray.model': 'Model',
  'tray.model_unconfigured': '(no provider key — open Settings)',
  'tray.demo': 'Demo: thinking → celebrate → idle',
  'tray.update_check': 'Check for updates (current v{0})',
  'tray.quit': 'Quit DeskPet',

  // —— Chat system bubble / hints ——
  'chat.history_cleared_provider_switch':
    'Switched to {0} — cross-provider context is incompatible, prior chat cleared',
  'chat.update_available': 'Version v{0} is available — copy release link: {1}',
  'chat.update_up_to_date': 'Already on latest (v{0})',
  'chat.empty_placeholder': 'Say something to the pet',
  'chat.kbd_send_close': '{0} to send · {1} to close',

  // —— Tool display labels ——
  'tool_label.web_search': 'Web search',
  'tool_label.x_search': 'X live search',
  'tool_label.google_search': 'Google search',
  'tool_label.code_execution': 'Run code',
  'tool_label.fetch_url': 'Fetch URL',
  'tool_label.read_file': 'Read file',
  'tool_label.write_file': 'Write file',
  'tool_label.delete_file': 'Delete file',
  'tool_label.move_file': 'Move file',
  'tool_label.list_directory': 'List dir',
  'tool_label.find_files': 'Find files',
  'tool_label.create_directory': 'Create dir',
  'tool_label.write_docx': 'Word doc',
  'tool_label.write_xlsx': 'Excel sheet',
  'tool_label.write_pdf': 'PDF doc',
  'tool_label.run_command': 'Terminal',
  'tool_label.read_clipboard': 'Read clipboard',
  'tool_label.copy_to_clipboard': 'Write clipboard',
  'tool_label.open_url': 'Open URL',
  'tool_label.current_app_info': 'Front app info',
  'tool_label.view_screen': 'View screen',
  'tool_label.get_weather': 'Get weather',
  'tool_label.read_system_preference': 'System pref',
  'tool_label.set_pet_animation': 'Pet animation',

  // —— Tool card status ——
  'tool.status.running': 'running',
  'tool.status.done': 'done',
  'tool.status.error': 'failed',

  // —— Settings ——
  'settings.section.ai_engine': 'AI engine',
  'settings.ai_engine_hint':
    'Configure keys + pick which one to chat with. At least one is needed. Keys are encrypted via Electron safeStorage (Keychain-backed AES-256 on macOS), never uploaded.',
  'settings.chip_current': '● current',
  'settings.switch_to': 'Switch to this →',
  'settings.unconfigured': 'unconfigured',
  'settings.current_model': 'Current model',
  'settings.tag_reasoning': 'reasoning',
  'settings.tag_no_tool': 'no tools',
  'settings.tag_no_vision': 'no vision',
  'settings.placeholder_overwrite': 'paste new key to overwrite (empty = keep)',
  'settings.placeholder_paste_key': 'paste key',
  'settings.save': 'Save',
  'settings.clear': 'Clear',
  'settings.registration': 'Register:',
  'settings.fallback_hint':
    'ⓘ When the current provider is overloaded, DeskPet auto-falls-back to another configured provider. Switching provider starts a new conversation (cross-provider history is incompatible).',
  'settings.balance_label': 'Balance / Usage',
  'settings.balance_loading': 'Loading...',
  'settings.balance_refresh': '↻ Refresh',
  'settings.balance_retry': '↻ Retry',
  'settings.balance_check': 'Check balance',
  'settings.balance_no_api': 'No public API →',
  'settings.balance_dashboard': 'Dashboard',
  'settings.balance_dashboard_link': 'Open official dashboard',
  'settings.loading_state': 'Loading provider/model state...',

  // —— Approval modal ——
  'approval.title': 'Confirmation needed',
  'approval.allow_once': 'Allow once',
  'approval.deny': 'Deny',
  'approval.trust_dir_session': 'Trust this folder this session',
  'approval.trust_dir_persistent': 'Trust this folder permanently',
  'approval.batch_count': '{0} total',

  // —— Drop overlay ——
  'drop.overlay_text': 'Drop to feed me',
  'drop.overlay_hint': 'Drop files for the pet as chat context',

  // —— Errors ——
  'err.no_api_key': 'No API key configured — add one in Settings',
  'err.invalid_api_key': 'API key invalid — check or re-enter',
  'err.rate_limited': 'Rate-limited, hold on',
  'err.overloaded': 'Provider overloaded, falling back...',
  'err.network': 'Network issue, retry',
  'err.empty_response': 'AI returned nothing — try another model',
  'err.unknown': 'Error: {0}'
}
