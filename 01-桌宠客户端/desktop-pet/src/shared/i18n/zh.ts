/**
 * 中文字符串字典 — i18n 单一来源 (zh).
 *
 * 这是字典的"权威 schema": 所有 key 必须先在这里定义, en.ts 必须 satisfies 同 shape.
 *
 * 命名规则:
 *   <area>.<sub>.<purpose>  (snake_case, dot 分层)
 *   - tray.* / settings.* / chat.* / approval.* / system.* / err.* / tool_label.*
 *
 * 参数化字符串用 {0} {1} 占位符, t() 会替换:
 *   tray.update_check_label: '检查更新（当前 v{0}）'
 *   t('tray.update_check_label', '0.4.1') → '检查更新（当前 v0.4.1）'
 */

export const zh = {
  // —— Tray 托盘菜单 ——
  'tray.show_hide': '显示 / 隐藏桌宠',
  'tray.reset_position': '重置位置（右下角）',
  'tray.mini_mode': '极简模式（藏屏幕边缘）',
  'tray.vision': '屏幕感知（AI 看屏）',
  'tray.activity_label': '当前活动：{0} {1}',
  'tray.activity_disabled': '当前活动：（未跟随）',
  'tray.follow_front_app': '跟随前台 App',
  'tray.strict_llm': '严格 LLM 识别（关 fast-path）',
  'tray.settings': '设置…',
  'tray.reset_key': '重设 API Key…',
  'tray.model': '模型',
  'tray.model_unconfigured': '（未配置任何 provider key — 打开设置）',
  'tray.demo': 'Demo: 思考 → 庆祝 → 待机',
  'tray.update_check': '检查更新（当前 v{0}）',
  'tray.quit': '退出 DeskPet',

  // —— Chat 系统气泡 / 提示 ——
  'chat.history_cleared_provider_switch': '已切到 {0} — 跨家不兼容, 之前对话已清开始新轮次',
  'chat.update_available': '新版本 v{0} 可用 — 点击复制 release 链接: {1}',
  'chat.update_up_to_date': '已是最新版本 (v{0})',
  'chat.empty_placeholder': '对桌宠说点啥',
  'chat.kbd_send_close': '{0} 发送 · {1} 关闭',

  // —— Tool 显示标签 (msg-tool 卡 / pet-toast) ——
  'tool_label.web_search': '联网搜索',
  'tool_label.x_search': 'X 实时搜索',
  'tool_label.google_search': 'Google 搜索',
  'tool_label.code_execution': '代码执行',
  'tool_label.fetch_url': '抓取网页',
  'tool_label.read_file': '读文件',
  'tool_label.write_file': '写文件',
  'tool_label.delete_file': '删文件',
  'tool_label.move_file': '移动文件',
  'tool_label.list_directory': '列目录',
  'tool_label.find_files': '搜文件',
  'tool_label.create_directory': '建目录',
  'tool_label.write_docx': 'Word 文档',
  'tool_label.write_xlsx': 'Excel 表格',
  'tool_label.write_pdf': 'PDF 文档',
  'tool_label.run_command': '终端',
  'tool_label.read_clipboard': '读剪贴板',
  'tool_label.copy_to_clipboard': '写剪贴板',
  'tool_label.open_url': '打开链接',
  'tool_label.current_app_info': '查前台 App',
  'tool_label.view_screen': '看屏幕',
  'tool_label.get_weather': '查天气',
  'tool_label.read_system_preference': '系统设置',
  'tool_label.set_pet_animation': '桌宠动作',

  // —— Tool card 状态 ——
  'tool.status.running': '运行中',
  'tool.status.done': '完成',
  'tool.status.error': '失败',

  // —— Settings 设置面板 ——
  'settings.section.ai_engine': 'AI 引擎',
  'settings.ai_engine_hint':
    '配 key + 切当前对话用哪家. 至少配一个让桌宠开口. Key 用 Electron safeStorage (macOS Keychain backed AES-256) 加密落盘, 绝不上传.',
  'settings.chip_current': '● 当前使用',
  'settings.switch_to': '切换到此 →',
  'settings.unconfigured': '未配置',
  'settings.current_model': '当前模型',
  'settings.tag_reasoning': '推理',
  'settings.tag_no_tool': '无 tool',
  'settings.tag_no_vision': '无 vision',
  'settings.placeholder_overwrite': '粘贴新 key 覆盖（留空不动）',
  'settings.placeholder_paste_key': 'paste key',
  'settings.save': '保存',
  'settings.clear': '清除',
  'settings.registration': '注册：',
  'settings.fallback_hint':
    'ⓘ 当前 provider 过载时自动 fallback 到其它已配 provider 继续对话. 切换 provider = 新对话开始 (跨家历史不兼容).',
  'settings.balance_label': '余额 / 用量',
  'settings.balance_loading': '查询中...',
  'settings.balance_refresh': '↻ 刷新',
  'settings.balance_retry': '↻ 重试',
  'settings.balance_check': '查余额',
  'settings.balance_no_api': '无公开 API →',
  'settings.balance_dashboard': '官方面板',
  'settings.balance_dashboard_link': '打开官方面板',
  'settings.loading_state': '加载 provider/model 状态中...',

  // —— Approval modal ——
  'approval.title': '需要你的确认',
  'approval.allow_once': '本次允许',
  'approval.deny': '拒绝',
  'approval.trust_dir_session': '本会话信任此目录',
  'approval.trust_dir_persistent': '永久信任此目录',
  'approval.batch_count': '一共 {0} 个',

  // —— Drop overlay ——
  'drop.overlay_text': '松手喂我',
  'drop.overlay_hint': '把文件丢给桌宠当上下文',

  // —— Errors (renderer surface) ——
  'err.no_api_key': '还没配 API key — 设置里加一个',
  'err.invalid_api_key': 'API key 无效 — 检查或重设',
  'err.rate_limited': '被限流了, 缓一下',
  'err.overloaded': 'provider 过载, 自动切下家中...',
  'err.network': '网络问题, 重试一下',
  'err.empty_response': 'AI 没回 — 换模型试试',
  'err.unknown': '出错了: {0}'
} as const

export type I18nKey = keyof typeof zh
export type I18nDict = Readonly<Record<I18nKey, string>>
