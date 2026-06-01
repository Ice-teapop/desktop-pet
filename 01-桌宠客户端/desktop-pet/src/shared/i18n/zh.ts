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
  'tray.import_files': '📂 导入文件给桌宠…',
  'tray.import_dialog_title': '选要喂给桌宠的文件',
  'tray.wizard_toggle': '🧙 巫师模式',
  'tray.demo': 'Demo: 思考 → 庆祝 → 待机',
  'tray.update_check': '检查更新（当前 v{0}）',
  'tray.quit': '退出 DeskPet',

  // —— Chat 系统气泡 / 提示 ——
  'chat.history_cleared_provider_switch': '已切到 {0} — 跨家不兼容, 之前对话已清开始新轮次',
  'chat.fallback_note': '\n_( {0} {1}, 已切到 {2} )_\n\n',
  'chat.fallback_reason.overloaded': '过载',
  'chat.fallback_reason.rate_limited': '限流',
  'chat.fallback_reason.empty_response': 'API 异常 (无回复)',
  'chat.fallback_reason.unavailable': '不可用',
  'chat.update_available': '新版本 v{0} 可用 — 点击复制 release 链接: {1}',
  'chat.update_up_to_date': '已是最新版本 (v{0})',
  'chat.empty_placeholder': '对桌宠说点啥',
  'chat.import_files_title': '导入文件给桌宠（系统选择器）',
  'chat.empty_placeholder_dots': '对桌宠说点啥...',
  'chat.placeholder_initializing': '正在初始化…',
  'chat.placeholder_replying': 'Claw 正在回复…',
  'chat.placeholder_paste_key': '粘任意 provider 的 API key (sk-ant-/sk-/AIza/xai-/UUID)',
  'chat.kbd_send_close': '{0} 发送 · {1} 关闭',

  // —— Tool 显示标签 (msg-tool 卡 / pet-toast) ——
  'tool_label.web_search': '联网搜索',
  'tool_label.x_search': 'X 实时搜索',
  'tool_label.google_search': 'Google 搜索',
  'tool_label.code_execution': '代码执行',
  'tool_label.fetch_url': '抓取网页',
  'tool_label.read_file': '读文件',
  'tool_label.write_file': '写文件',
  'tool_label.delete_file': '移到废纸篓',
  'tool_label.move_file': '移动文件',
  'tool_label.copy_file': '复制文件',
  'tool_label.organize_files': '整理文件',
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
  'settings.h1': 'DeskPet 设置',
  'settings.section.ai_engine': 'AI 引擎',
  'settings.section.recognition': '识别 / 自动化',
  'settings.section.agentic': 'Agentic 工具（M4）',
  'settings.section.trust_dirs': '信任目录 + 审计日志',
  'settings.section.user_profile': '用户档案',
  'settings.section.memory': '跨会话记忆',
  'settings.section.about': '关于',
  // Toast
  'settings.toast.key_saved': '{0} key 已加密保存',
  'settings.toast.key_cleared': '{0} key 已清除',
  'settings.toast.switched_provider': '已切到 {0}（跨 provider 自动开新对话）',
  'settings.toast.tavily_saved': 'Tavily key 已加密保存',
  'settings.toast.tavily_cleared': 'Tavily key 已清除',
  'settings.toast.vision_revoked': '已撤销屏幕感知 consent',
  'settings.toast.vision_consent_enabled': '已同意 consent + 启用屏幕感知',
  'settings.toast.audit_cleared': '审计日志已清空',
  'settings.toast.audit_clear_failed': '清空失败：{0}',
  'settings.toast.memory_saved': '长期记忆已保存',
  'settings.toast.memory_save_failed': '保存失败：{0}',
  'settings.toast.memory_cleared': '长期记忆已清空',
  'settings.toast.memory_clear_failed': '清空失败：{0}',
  'settings.toast.chat_history_cleared': '对话历史已清空（含桌宠 UI）',
  'settings.toast.chat_history_clear_failed': '清空失败：{0}',
  'settings.toast.profile_saved': '用户档案已保存',
  'settings.toast.profile_save_failed': '保存失败：{0}',
  'settings.toast.wizard_reset': '已重置 —— 下次对话 AI 会重走 wizard 流程',
  'settings.toast.wizard_reset_failed': '重置失败：{0}',
  'settings.toast.persistent_revoked': '已撤销永久信任：{0}',
  'settings.toast.persistent_revoke_failed': '撤销失败：{0}',
  'settings.toast.session_dirs_cleared': '会话信任目录已清空',
  // Tavily card
  'settings.tavily.label': 'Tavily 联网搜索（可选）',
  'settings.tavily.configured': '已配置',
  'settings.tavily.unconfigured': '未配置',
  'settings.tavily.hint':
    '设了之后 AI 可调 web_search tool 联网查询（免费 1000 次/月）。隐私：query 发 api.tavily.com。',
  'settings.tavily.placeholder': 'tvly-...',
  'settings.tavily.registration': '注册：',
  // Recognition section
  'settings.recognition.hint':
    '桌宠通过观察前台 App 自动识别你在干啥 (写代码 / 写文档 / 聊天 / 听音乐). 活动分类用 Anthropic Claude Haiku 4.5 hardcoded (cost/speed 最优), 不跟随上面 provider 选择切换.',
  'settings.recognition.follow_front': '跟随前台 App 自动识别活动状态',
  'settings.recognition.strict_llm': '严格 LLM 识别（关 fast-path bundleID 白名单）',
  // Agentic section
  'settings.agentic.label': '屏幕感知 + 全部 tools',
  'settings.agentic.status_enabled': '启用中',
  'settings.agentic.status_disabled': '已 consent 但 toggle 关',
  'settings.agentic.status_no_consent': '未 consent',
  'settings.agentic.consent_hint':
    '⚠️ 启用后 AI 会在你问"看看屏幕"等问题时截屏发往 Anthropic. 本地不存盘, 可随时关. 同意才能继续.',
  'settings.agentic.consent_accept': '同意并启用',
  'settings.agentic.enable': '启用',
  'settings.agentic.disable': '关闭',
  'settings.agentic.revoke': '撤销 consent',
  'settings.agentic.tools_summary': '当前 AI 可用工具（共 18 个）',
  'settings.agentic.tools_li_1': '— 上下文采集',
  'settings.agentic.tools_li_2': '— 浏览器 + 剪贴板',
  'settings.agentic.tools_li_3': '— 文件读取',
  'settings.agentic.tools_li_4': '— 文件写入（delete 必弹审批）',
  'settings.agentic.tools_li_5': '— shell 命令（safe 白名单静默 / 其它弹审批 / 危险命令永拒）',
  'settings.agentic.tools_li_6': '— 系统设置',
  'settings.agentic.tools_li_7': '— 网络',
  // Trust dirs section
  'settings.trust.persistent_label': '永久信任目录（持久化）',
  'settings.trust.persistent_empty': '（无 —— 用户在审批 modal 上点「永久信任」后会出现在这里）',
  'settings.trust.persistent_revoke': '撤销',
  'settings.trust.session_label': '本会话信任目录',
  'settings.trust.session_count': '{0} 个',
  'settings.trust.session_clear': '清空',
  'settings.trust.note':
    '注：HOME 下 visible 顶级目录（~/Documents 等）默认信任，不在此列表里 —— 那是基线，不能撤销。',
  'settings.audit.label': '审计日志',
  'settings.audit.reveal': '在 Finder 显示',
  'settings.audit.clear': '清空',
  'settings.audit.hint':
    '应用数据目录下的 audit.log（DeskPet-Furina 默认：~/Library/Application Support/DeskPet-Furina/audit.log）—— JSONL append-only，5MB 自动滚动；仅本地，不上传。',
  // User profile section
  'settings.profile.status_label': '状态',
  'settings.profile.status_set': '已设置',
  'settings.profile.status_unset': '未设置（下次对话 AI 会走 wizard）',
  'settings.profile.name_label': '称呼',
  'settings.profile.name_placeholder': '（如 Han）',
  'settings.profile.about_label': '关于你',
  'settings.profile.about_placeholder': '（工作 / 项目 / 兴趣 / 技术栈 / 习惯 …）',
  'settings.profile.persona_label': '桌宠对话风格',
  'settings.profile.persona_custom_label': '自定义风格补充',
  'settings.profile.persona_custom_placeholder':
    '（如：喜欢中英混用术语、回答尽量短、不要 emoji…）',
  'settings.profile.save': '保存档案',
  'settings.profile.reset_wizard': '重置 wizard（让 AI 重问一遍）',
  'settings.profile.loading': '加载中...',
  // Memory section
  'settings.memory.history_label': '对话历史',
  'settings.memory.history_clear': '清空对话历史',
  'settings.memory.history_hint':
    '保留最近 10 对话往复；桌宠重启后自动恢复让对话不丢上下文。点上面按钮会同步清空桌宠对话区 UI。',
  'settings.memory.long_label': '长期记忆（可直接编辑）',
  'settings.memory.reread': '从盘上重读',
  'settings.memory.clear_all': '清空全部',
  'settings.memory.save': '保存',
  'settings.memory.hint':
    'AI 调 remember tool 时自动追加到这里。你也可以直接改 —— 每行一条事实，AI 下次对话会看到。markdown 格式自由发挥。',
  'settings.memory.placeholder': '（空 —— AI 还没记下任何东西；你也可以手动写。每行一条事实）',
  // About section
  'settings.about.body': 'DeskPet 智能桌宠助手 · 透明置顶桌宠 + 多模态 AI（6 provider 多家选）',
  'settings.about.shortcuts': '快捷键：{0} 打开本面板 · {1} 显示/隐藏桌宠 · {2} 退出',
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
  'approval.title': '⚠️ AI 请求授权',
  'approval.queue_badge': '· 队列 {0}',
  'approval.label_path': '路径：',
  'approval.label_paths': '批量路径（{0} 个）：',
  'approval.label_command': '命令：',
  'approval.label_content_preview': '内容预览：',
  'approval.hint_auto_deny': 'tool: {0} · 60s 不操作自动拒绝',
  'approval.allow_once': '允许一次',
  'approval.allow_batch': '允许全部 {0} 个',
  'approval.deny': '拒绝',
  'approval.deny_batch': '拒绝整批',
  'approval.trust_dir_session': '信任此目录（本会话）',
  'approval.trust_dir_persistent': '永久信任此目录',
  'approval.batch_count': '一共 {0} 个',
  'approval.close': '关闭',

  // —— Drop overlay ——
  'drop.overlay_text': '松手喂我',
  'drop.overlay_hint': '把文件丢给桌宠当上下文',

  // —— Errors (renderer surface) ——
  'err.no_api_key': '还没配 API key — 设置里加一个',
  'err.invalid_api_key': '⚠️ 这个 API key 被 Anthropic 拒了，重新贴一个吧',
  'err.rate_limited_with_sec': '⏱️ 太快了，{0}s 后再试',
  'err.rate_limited': '⏱️ 请求过快，等等再问',
  'err.overloaded': '😵 Claude 现在很忙，稍等再问',
  'err.network': '🌐 连不上 Anthropic，检查下网络',
  'err.key_not_persisted':
    '⚠️ 系统没装加密后端，这次能聊但下次启动 key 会丢（Linux 装个 libsecret / gnome-keyring 就好）',
  'err.key_format_invalid': '⚠️ 这个 key 格式不对，检查下复制有没有带空格 / 多余字符',
  'err.empty_response_intro': '⚠️ AI 这次没产生输出 (finishReason={0})。可能原因:',
  'err.empty_response_reason_1':
    '• 切到 Opus/Sonnet + 复杂 prompt 时全花在思考没 text output → 重试或换 Haiku',
  'err.empty_response_reason_2': '• 工具 schema 被 provider 拒绝 → 关掉视觉/Tavily 重试',
  'err.empty_response_reason_3':
    '• Key 跟 provider 不匹配 → 去设置 (⌘+,) 检查 model 跟 key 是同一家',
  'err.tool_loop_limit':
    '⚠️ 连续调用工具已达到 {0} 步上限，我先停住防止循环。刚才的工具卡是已执行记录；可以让我继续或把范围缩小一点。',
  'err.api': '⚠️ {0}',
  'err.unknown': '⚠️ 出错了：{0}'
} as const

export type I18nKey = keyof typeof zh
export type I18nDict = Readonly<Record<I18nKey, string>>
