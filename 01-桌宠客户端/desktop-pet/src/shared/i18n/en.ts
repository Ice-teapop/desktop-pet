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
  'tray.import_files': '📂 Feed files to pet…',
  'tray.import_dialog_title': 'Pick files to feed the pet',
  'tray.wizard_toggle': '🧙 Wizard mode',
  'tray.demo': 'Demo: thinking → celebrate → idle',
  'tray.update_check': 'Check for updates (current v{0})',
  'tray.quit': 'Quit DeskPet',

  // —— Chat system bubble / hints ——
  'chat.history_cleared_provider_switch':
    'Switched to {0} — cross-provider context is incompatible, prior chat cleared',
  'chat.fallback_note': '\n_( {0} {1}, switched to {2} )_\n\n',
  'chat.fallback_reason.overloaded': 'overloaded',
  'chat.fallback_reason.rate_limited': 'rate-limited',
  'chat.fallback_reason.empty_response': 'API error (empty reply)',
  'chat.fallback_reason.unavailable': 'unavailable',
  'chat.update_available': 'Version v{0} is available — copy release link: {1}',
  'chat.update_up_to_date': 'Already on latest (v{0})',
  'chat.empty_placeholder': 'Say something to the pet',
  'chat.import_files_title': 'Feed files to the pet (system picker)',
  'chat.empty_placeholder_dots': 'Say something to the pet...',
  'chat.placeholder_initializing': 'Initializing…',
  'chat.placeholder_replying': 'Claw is replying…',
  'chat.placeholder_paste_key': 'Paste any provider API key (sk-ant- / sk- / AIza / xai- / UUID)',
  'chat.kbd_send_close': '{0} to send · {1} to close',

  // —— Tool display labels ——
  'tool_label.web_search': 'Web search',
  'tool_label.x_search': 'X live search',
  'tool_label.google_search': 'Google search',
  'tool_label.code_execution': 'Run code',
  'tool_label.fetch_url': 'Fetch URL',
  'tool_label.read_file': 'Read file',
  'tool_label.write_file': 'Write file',
  'tool_label.delete_file': 'Move to Trash',
  'tool_label.move_file': 'Move file',
  'tool_label.copy_file': 'Copy file',
  'tool_label.organize_files': 'Organize files',
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
  'settings.h1': 'DeskPet Settings',
  'settings.section.ai_engine': 'AI engine',
  'settings.section.recognition': 'Activity recognition',
  'settings.section.agentic': 'Agentic tools (M4)',
  'settings.section.trust_dirs': 'Trusted folders + audit log',
  'settings.section.user_profile': 'User profile',
  'settings.section.memory': 'Cross-session memory',
  'settings.section.about': 'About',
  // Toast
  'settings.toast.key_saved': '{0} key saved (encrypted)',
  'settings.toast.key_cleared': '{0} key cleared',
  'settings.toast.switched_provider': 'Switched to {0} (cross-provider opens a new conversation)',
  'settings.toast.tavily_saved': 'Tavily key saved (encrypted)',
  'settings.toast.tavily_cleared': 'Tavily key cleared',
  'settings.toast.vision_revoked': 'Screen awareness consent revoked',
  'settings.toast.vision_consent_enabled': 'Consent accepted + screen awareness enabled',
  'settings.toast.audit_cleared': 'Audit log cleared',
  'settings.toast.audit_clear_failed': 'Clear failed: {0}',
  'settings.toast.memory_saved': 'Long-term memory saved',
  'settings.toast.memory_save_failed': 'Save failed: {0}',
  'settings.toast.memory_cleared': 'Long-term memory cleared',
  'settings.toast.memory_clear_failed': 'Clear failed: {0}',
  'settings.toast.chat_history_cleared': 'Chat history cleared (incl. pet UI)',
  'settings.toast.chat_history_clear_failed': 'Clear failed: {0}',
  'settings.toast.profile_saved': 'User profile saved',
  'settings.toast.profile_save_failed': 'Save failed: {0}',
  'settings.toast.wizard_reset': 'Reset — AI will rerun the wizard on next chat',
  'settings.toast.wizard_reset_failed': 'Reset failed: {0}',
  'settings.toast.persistent_revoked': 'Revoked permanent trust: {0}',
  'settings.toast.persistent_revoke_failed': 'Revoke failed: {0}',
  'settings.toast.session_dirs_cleared': 'Session trusted dirs cleared',
  // Tavily card
  'settings.tavily.label': 'Tavily web search (optional)',
  'settings.tavily.configured': 'configured',
  'settings.tavily.unconfigured': 'unconfigured',
  'settings.tavily.hint':
    'When set, AI can call the web_search tool (free 1000/month). Privacy: queries go to api.tavily.com.',
  'settings.tavily.placeholder': 'tvly-...',
  'settings.tavily.registration': 'Register:',
  // Recognition section
  'settings.recognition.hint':
    "DeskPet watches your front app to figure out what you're doing (coding / writing / chatting / music). Classification uses Anthropic Claude Haiku 4.5 hardcoded (best cost/speed), independent of the provider you pick above.",
  'settings.recognition.follow_front': 'Auto-detect activity from front app',
  'settings.recognition.strict_llm': 'Strict LLM classify (disable fast-path bundleID allowlist)',
  // Agentic section
  'settings.agentic.label': 'Screen awareness + all tools',
  'settings.agentic.status_enabled': 'enabled',
  'settings.agentic.status_disabled': 'consented but toggle off',
  'settings.agentic.status_no_consent': 'no consent',
  'settings.agentic.consent_hint':
    '⚠️ When enabled, AI will screenshot and send to Anthropic when you ask things like "look at my screen". Not stored locally, can be turned off any time. Consent required.',
  'settings.agentic.consent_accept': 'Accept + enable',
  'settings.agentic.enable': 'Enable',
  'settings.agentic.disable': 'Disable',
  'settings.agentic.revoke': 'Revoke consent',
  'settings.agentic.tools_summary': 'Tools currently available to AI (18 total)',
  'settings.agentic.tools_li_1': '— context capture',
  'settings.agentic.tools_li_2': '— browser + clipboard',
  'settings.agentic.tools_li_3': '— file read',
  'settings.agentic.tools_li_4': '— file write (delete always prompts)',
  'settings.agentic.tools_li_5':
    '— shell commands (safe allowlist silent / others prompt / dangerous always denied)',
  'settings.agentic.tools_li_6': '— system preferences',
  'settings.agentic.tools_li_7': '— network',
  // Trust dirs section
  'settings.trust.persistent_label': 'Permanent trusted folders',
  'settings.trust.persistent_empty':
    '(none — folders you mark "Trust permanently" in approval modal show up here)',
  'settings.trust.persistent_revoke': 'Revoke',
  'settings.trust.session_label': 'Session trusted folders',
  'settings.trust.session_count': '{0} total',
  'settings.trust.session_clear': 'Clear',
  'settings.trust.note':
    "Note: visible top-level folders under HOME (~/Documents etc.) are trusted by default and don't appear here — that's the baseline and can't be revoked.",
  'settings.audit.label': 'Audit log',
  'settings.audit.reveal': 'Reveal in Finder',
  'settings.audit.clear': 'Clear',
  'settings.audit.hint':
    'audit.log under the app userData folder (DeskPet-Furina default: ~/Library/Application Support/DeskPet-Furina/audit.log) — JSONL append-only, auto-rotates at 5MB; local-only, not uploaded.',
  // User profile section
  'settings.profile.status_label': 'Status',
  'settings.profile.status_set': 'set',
  'settings.profile.status_unset': 'not set (AI will run wizard on next chat)',
  'settings.profile.name_label': 'Name',
  'settings.profile.name_placeholder': '(e.g. Han)',
  'settings.profile.about_label': 'About you',
  'settings.profile.about_placeholder': '(work / projects / interests / stack / habits …)',
  'settings.profile.persona_label': 'Pet conversation style',
  'settings.profile.persona_custom_label': 'Custom style notes',
  'settings.profile.persona_custom_placeholder':
    '(e.g.: mix Chinese/English tech terms, keep replies short, no emoji…)',
  'settings.profile.save': 'Save profile',
  'settings.profile.reset_wizard': 'Reset wizard (let AI ask again)',
  'settings.profile.loading': 'Loading...',
  // Memory section
  'settings.memory.history_label': 'Chat history',
  'settings.memory.history_clear': 'Clear chat history',
  'settings.memory.history_hint':
    'Keeps the last 10 turn pairs; pet auto-restores after restart so chat context survives. The button above also clears the pet chat UI.',
  'settings.memory.long_label': 'Long-term memory (editable)',
  'settings.memory.reread': 'Reread from disk',
  'settings.memory.clear_all': 'Clear all',
  'settings.memory.save': 'Save',
  'settings.memory.hint':
    "AI's remember tool auto-appends here. You can edit directly — one fact per line, AI will see it next chat. Markdown freeform.",
  'settings.memory.placeholder':
    '(empty — AI has no notes yet; you can write some yourself. One fact per line)',
  // About section
  'settings.about.body':
    'DeskPet · transparent always-on-top character + multi-modal AI (pick from 6 providers)',
  'settings.about.shortcuts': 'Shortcuts: {0} open this panel · {1} show/hide pet · {2} quit',
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
  'approval.title': '⚠️ AI requests authorization',
  'approval.queue_badge': '· queue {0}',
  'approval.label_path': 'Path:',
  'approval.label_paths': 'Batch paths ({0}):',
  'approval.label_command': 'Command:',
  'approval.label_content_preview': 'Content preview:',
  'approval.hint_auto_deny': 'tool: {0} · auto-deny after 60s',
  'approval.allow_once': 'Allow once',
  'approval.allow_batch': 'Allow all {0}',
  'approval.deny': 'Deny',
  'approval.deny_batch': 'Deny batch',
  'approval.trust_dir_session': 'Trust this folder (session)',
  'approval.trust_dir_persistent': 'Trust this folder permanently',
  'approval.batch_count': '{0} total',
  'approval.close': 'Close',

  // —— Drop overlay ——
  'drop.overlay_text': 'Drop to feed me',
  'drop.overlay_hint': 'Drop files for the pet as chat context',

  // —— Errors ——
  'err.no_api_key': 'No API key yet — add one in Settings',
  'err.invalid_api_key': '⚠️ This API key was rejected — paste a fresh one',
  'err.rate_limited_with_sec': '⏱️ Too fast, retry in {0}s',
  'err.rate_limited': '⏱️ Rate-limited, slow down a bit',
  'err.overloaded': '😵 Claude is busy right now, retry shortly',
  'err.network': "🌐 Can't reach Anthropic, check your network",
  'err.key_not_persisted':
    '⚠️ No encryption backend on this OS, can chat this session but key will be lost on next launch (Linux: install libsecret / gnome-keyring)',
  'err.key_format_invalid': '⚠️ Key format looks wrong, check for extra whitespace or stray chars',
  'err.empty_response_intro': '⚠️ AI returned no output (finishReason={0}). Possible reasons:',
  'err.empty_response_reason_1':
    '• Opus/Sonnet + complex prompt spent budget on thinking with no text output → retry or switch to Haiku',
  'err.empty_response_reason_2':
    '• Tool schema rejected by provider → disable vision/Tavily and retry',
  'err.empty_response_reason_3':
    '• Key/provider mismatch → Settings (⌘+,) — make sure model and key are from the same provider',
  'err.tool_loop_limit':
    '⚠️ Tool chaining reached the {0}-step safety limit, so I stopped to avoid a loop. The tool cards above are the executed actions; ask me to continue or narrow the scope.',
  'err.api': '⚠️ {0}',
  'err.unknown': '⚠️ Error: {0}'
}
