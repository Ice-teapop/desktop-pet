# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

---

## [0.5.1] — 2026-06-10 · 修复待机无形象

### 修复
- **待机时桌宠不显示形象**：待机/默认态的角色由 `IdleFollowSvg`（`idle.svg?react`）单独渲染，依赖 vite-plugin-svgr 处理 `?react`。实测 `idle.svg?react` 返回的是**原始 SVG 文本**而非 React 组件（svgr 没命中 `themes/` 路径的 `?react` import）→ 组件渲染空 → 待机一片空白；其它状态走 `<img src>` 正常，所以只有启动默认态没形象。改为待机也走 `<img src={idleGif}>`，与所有其它状态一致，移除对 svgr `?react` 的依赖。光标跟随倾斜在 `.pet` 容器上做，不受影响。

---

## [0.5.0] — 2026-06-10 · 审查加固 + 睡眠/交互直觉

一轮系统审查（主审 + 8 个并行 review agent）后的加固版：修掉安全绕过、状态机死锁、睡眠逻辑反直觉、跨 provider 文案误导等问题。

### 安全
- **命令白名单两个绕过修复**：① SAFE 命令经 `--flag=path`（如 `git diff --output=/Users/x/.ssh/y`）把写入路径塞进 flag value 绕过 path-safety 黑名单 → 现在拆 `=` 后的 value 一并校验；② `rm` 硬拒正则被 flag 顺序/长选项绕过（`rm -fr /` / `rm --recursive --force /` / `rm -rf /Users/x` 均逃逸）→ 改 tokenize 语义判定，任意 flag 形态指向根/家目录/系统目录一律永久拒。
- **trust-dir 越界信任修复**：目录类工具（find_files / list_directory / create_directory）的"信任此目录"以前被当文件剥末段 → 信任 `~/Documents` 实际信任了 `~`。ApprovalRequest 加 `pathIsDir` 区分。
- **approval 超时撤 modal**：60s auto-deny 后通知 renderer 移除残留 modal，防用户事后点"允许"静默无效。

### 修复
- **状态机死锁**：error 表情进入后永久卡死（优先级 gate 拒绝回收）、中断流后永久卡 thinking 转圈 → setState 加 `force` 旁路，权威生命周期转换（error 回收 / 新对话 / abort 重置）强制落地。
- **睡眠逻辑反直觉**：① 敲代码 / 聊天框开着时桌宠会偷偷睡着（sleep timer 只看 state 不看 activity）→ 加 `canSleep` 门控，只在真正发呆时睡；② 睡眠触发 60s → 180s；③ mini 模式睡觉显示醒着的 mini-idle → 接入 `mini-sleep.svg`；④ 戳/4连击在工作态静默失灵 → 加 `force`（睡眠链中让位 wake 不打断唤醒）。
- **流式错误处理**：stream 内 `error` part 被吞 → 流式 401/429/529 被误判 empty-response、坏 key 清理永不触发 → 捕获并归类；`classifyError` 把 NoOutputGenerated 判定移到 statusCode/body 之后。
- **fallback 副作用双写**：tool 执行后撞错误再 fallback 换家重跑会把 write_file/remember 双写 → tool 跑过即禁 fallback / 禁回滚。
- **provider key 生命周期**：非 anthropic 坏 key 清理不对称（状态灯仍绿 + 重启复活）补齐；reset key 现在也会 abort 跑在 fallback provider 上的流。
- **拖拽文件双发**：window 原生 drop 监听与 React onDrop 对同一次拖放都处理 → 共享处理 + 同步去重锁。
- **IPC 输入校验**：`window:move-delta`（NaN → setPosition 崩）、`window:ignore-mouse`、`tavily:submit-key`（undefined 存成字面量 key）补校验。
- **窗口**：`resetPetPosition` 不感知 mini 模式 → 改用 `computeModeBounds`。
- **审计准确性**：`get_weather` / `organize_files` 在操作前就记 `result:'ok'`（失败仍显示成功）→ 按真实结果记；move/copy 自动信任时记假的 `approved: allow-once` → 改记 `auto-trusted`。
- **organize_files** 恰好 50 个匹配被误判"太多"（off-by-one）。
- **Settings 表单**：`profileDirty` 闭包陈旧导致"编辑中不覆盖"失效 → 改 ref；保存 key 的 toast 过早乐观（可能假报成功）→ 改"已提交，校验中"。

### 变更（表达更符合直觉）
- 错误文案去掉写死的「Anthropic / Claude」（配 OpenAI/Gemini 的用户不再被指向错账号）。
- fallback 系统气泡显示 provider 友好名（"OpenAI" / "字节豆包"）而非原始 ID（`openai` / `bytedance`）。
- 等待气泡「Claw 正在回复」→「芙宁娜正在回复」/「Furina is replying」。
- 补 4 个工具的展示映射（open_system_settings / remember / load_skill / save_user_profile），不再显示原始函数名。

---

## [0.4.4] — 2026-05-20

### 新增
- **📂 "导入文件" 按钮**：聊天框模型 pill 旁边新增图标按钮，点击打开 macOS 系统文件选择器（multi-select），绕开透明 NSPanel 的 HTML5 drag-drop 限制
- **Tray drop-files 回退**：拖文件到 menu bar 螃蟹小图标也行（macOS 原生 `tray.on('drop-files')`）
- **PDF 真解析**：`read_file` 接 `pdf-parse` v2，返回全文 + 页数 metadata，AI 真能总结/翻译
- **DOCX 真解析**：`read_file` 接 `mammoth.extractRawText`，剥 XML 返 raw text
- **XLSX 真解析**：`read_file` 用已有 `exceljs` 读 sheets → tab-separated 文本
- **图片 vision input**：`read_file` 检测 PNG/JPG/GIF/WEBP → 返回 ToolContentBlock image (base64) 给 vision-capable model（Claude / GPT-4o / Gemini）真"看到"图片
- **接 3 个之前没用上的 sprite**：Settings about 头图、set_pet_animation 加 `carrying` / `ultrathink` 两种动画、进 mini 模式播 `mini-enter.gif` 过渡（~1.6s settle）

### 变更
- **`execReadFile` 加二进制嗅探**（前 8KB null byte + magic bytes）：PDF/Office/图片走专门 parser；未知二进制直接 reject 给 AI 可行替代方案，不再返 UTF-8 garbage
- **`read_file` 现在接 `ToolContext`**：用于检查 model 的 `supportsVision` 能力，决定图片走 vision 还是 reject

### 修复
- **拖文件检测多轮修**：
  - 修 Electron 32+ 移除 `File.path` → 改用 `webUtils.getPathForFile()`（preload bridge）
  - drag handler 从 240×240 `.pet` 上移到全窗口 `.stage`
  - `.stage` 加 `background: rgba(0,0,0,0.004)` 让 Chromium hit-test 命中（透明窗 trick）
  - 加 `window.addEventListener('drop')` 原生 fallback 监听器
  - 加 main 端 `console-message` 转发让 dev 在 terminal 直接看 [dnd] 日志
  - 最终诊断：透明 NSPanel + macOS 完全不派发 HTML5 drag 事件 → 走 Tray + 文件按钮回退

### 已知问题 / 限制
- **拖到桌宠本体**仍不行（Electron transparent NSPanel + macOS 限制）— 必须走 📂 按钮或拖到 menu bar 图标
- **PPTX 仍不解析** — 没好 parser
- **图片 > 3.5MB raw 拒绝** — Anthropic image_block 5MB base64 上限
- **PDF / DOCX 内嵌图片不提取** — 只提取文字
- **新依赖** `pdf-parse` + `mammoth` 共 ~13 个 transitive deps，app 体积 +~5MB

---

## [0.4.3] — 2026-05-20

### 修复
- **electron-builder win/linux artifactName 用 `${productName}` 不再用 `${name}`** — 之前 EN build (productName=DeskPet-EN) 跟 ZH build 撞同名 (`${name}` 都是 `desktop-pet`)，CI 6 job 都 success 但第二个上传的覆盖第一个，EN win/linux 包实际丢失。v0.4.2 因这个 bug 撤回未 publish。

---

## [0.4.2] — 2026-05-20 (withdrawn)

> ⚠️ 此版本因 electron-builder artifactName 撞名 bug 撤回，未公开 publish。
> 修复后内容随 [0.4.3](#043--2026-05-20) ship。

### 新增
- **🇬🇧 English-locale build**：独立 `DeskPet-EN.app`（`com.deskpet.en` appId）跟中文版并存
  - `npm run build:mac:en` / `build:win:en` / `build:linux:en` 三个新 script
  - userData 自动隔离（`~/Library/Application Support/DeskPet-EN/`）— 两 locale 用户配置互不干扰
  - UI 全英文（Settings / 系统气泡 / approval modal / tool 标签 / 错误提示 / drop overlay）
  - AI system prompt 英文版（严格镜像 ZH 工具指引 / 安全防护 / agentic 规则），默认英文回，跟随用户输入语言
  - 时间注入 / persona 风格 / 用户档案 wizard / 跨会话记忆 wrapper 都 LOCALE 化
- **🤖 GitHub Actions multi-platform CI**：push tag v\* 触发 6 个 matrix job（mac/win/linux × zh/en）自动 build + publish 到 Release；workflow_dispatch 手动触发出 14 天 artifact
- **i18n 基础设施**：`shared/i18n/{zh,en,index}.ts` + 约 200 keys + build-time `DESKPET_LOCALE` 注入（electron-vite define）

### 变更
- **clawd 像素美术正式入库**（65 sprite）— 拿到作者 [@rullerzhou-afk](https://github.com/rullerzhou-afk) **非商用授权** + Anthropic 中间方角色 IP 许可
  - `themes/clawd-dev/.gitignore` 翻转（之前排除一切，现在只排 .DS_Store 等）
  - 顶部 README + License section 重写 — 明示 source MIT + bundled assets 非商业 + 必须注明作者
- **`tools.ts` 中提取 `system-prompts.ts`** — SYSTEM_PROMPT / 时间 / persona / memory wrapper 都 LOCALE-aware
- **`tools.ts` 中 `set_pet_animation` 参数描述去 ZH 释义** — 改纯英文（"juggling (multi-task)" 等）

### 修复
- **electron-builder schema 校验**：`nsis.allowToChangeInstallationDir` → `allowToChangeInstallationDirectory`（v26.8.1 严格 validate）
- **CI manual build auto-publish**：`workflow_dispatch` 触发的 build 加 `--publish never`，否则 electron-builder 检测 CI 环境会强行 publish 失败

### 已知问题 / 限制
- **历史 release（v0.4.1 及之前）由本机 build 上传，未带正确 attribution** — v0.4.2 起所有 release 都含完整授权信息
- **macOS 仍无 codesign**，首次启动需脱 Gatekeeper（install.sh 自动处理）
- **EN system prompt 未真机验** — 翻译质量靠人工镜像 ZH，没用真模型跑过 8 项 scripted scenario
- **`src/main/llm/tools.ts` 18 个 tool description 仍有 ZH trigger 词**（"看看屏幕" / "天气" 等）— EN 用户说英文同义词时 vision/weather/animation tool 可能不触发，issue 单独 backlog

---

## [0.4.1] — 2026-05-19

### 新增
- **托盘"模型"菜单全 provider 展开**：二级 = 已配 key 的 provider；三级 = 该 provider 的 model（优先动态 listModels 24h cache）
- **跨 provider 工具显示统一**：`shared/tool-display.ts` — anthropic_web_search / openai_web_search / xai_web_search / tavily web_search 全归"🌐 联网搜索"；20+ tool 全有中文 label + emoji
- **provider 余额 / 用量行**：Settings 每张 provider 卡新增；DeepSeek 真查 `GET /user/balance`，其他 5 家给"官方面板"链接（无公开 API）
- **更新检查 + 通知**：启动 30s 后查 GitHub Releases / tray "检查更新（当前 vX.Y.Z）"；新版本 push 系统气泡含 release URL（无 codesign 不自动安装）
- **GitHub Actions multi-platform build**：`.github/workflows/release.yml` push tag v* 触发 mac / win / linux matrix build + publish 到 Release

### 变更
- **`classifyError` 加 Cloudflare gateway 错误码**：408 / 502 / 504 / 524 → `overloaded`（xAI / DeepSeek / OpenAI 走 CF 时常见）
- **`classifyError` 加余额关键字**：responseBody 含 `insufficient_quota` / `credits_exhausted` / `insufficient_funds` / `quota_exceeded` → `rate-limited`（fallback 到下家）
- **提取 `applySelectedModel`**：tray click + `selected-model:set` IPC 共享 body，修双实现易漂移
- **OpenAI `codeInterpreter` 显式 `container: 'auto'`**：意图可见，完整 per-session pinning 推迟（ADR-0003）
- **electron-builder linux 删 snap target**：保 AppImage + deb，删 snap 因需 Snap Store credentials
- **electron-builder win 显式 nsis + arch [x64, arm64]**：之前只 `executableName`

### 文档
- 新增 `CONTEXT.md`（领域术语表）+ `docs/adr/` 目录（ADR-0001 / ADR-0002 / ADR-0003）+ CHANGELOG 历史回填（v0.0.1 → v0.3.7）

### 已知问题 / 限制
- CI workflow **未跑过** — push 这个 tag 才会第一次触发，可能有路径 / 中文编码 / 平台特有坑
- macOS 仍无 codesign，首次启动需脱 Gatekeeper（install.sh 自动处理）
- 跨 provider tool result SHAPE 仍不一致（AI SDK 控制），只统一了 UI 显示标签
- OpenAI code_interpreter 跨 turn 无状态（per-session pinning 未做）
- 只 DeepSeek 有可查余额；Anthropic / OpenAI / Google / xAI / 字节都需官方面板

---

## [0.4.0] — 2026-05-18

### 新增
- **批量工具变体**：`delete_file.paths[]`（≤50）/ `write_file.files[]`（≤30）/ `move_file.moves[]`（≤50），AI 一次请求一次审批
- **approval modal 队列**：renderer 侧 `approvalQueue: ApprovalRequest[]`，并发请求按序展示
- **approval:displayed ACK**：60s 自动 deny 倒计时改在 renderer 真正显示后才启动
- **OpenAI native tools 模型白名单**：`OPENAI_NATIVE_TOOL_ALLOWED_FAMILIES = ['gpt-4o', 'gpt-4.1']`
- **拖文件喂上下文**（DnD）：renderer 拖文件到气泡，main 安全检查 + 文本预览 + 注入对话
- **动态 listModels**：`available-models` channel，Settings 实时同步真实可用模型列表 + 24h cache
- **指令预测**：静态预设 + 历史 + ghost text + TAB 立即发送
- **chat 顶部简化**：单颗模型 pill；vision / tavily 入口移到设置
- **pet-toast / emote-hint / busy-ring**：工具执行/活动状态的 pet 侧视觉反馈
- **DnD overlay**：拖文件到 pet 显示"松手喂我"

### 变更
- **selected-model 单一事实源**：`prefs:state.modelId` 删除，model state 只走 `selected-model:state`（详见 ADR-0001）
- **模型热切换两档**：同 provider 同 tool capability → 软切（不打断旧响应）；跨 provider → 硬切（清历史 + 系统气泡）（详见 ADR-0002）
- **`chat:history-cleared` 事件加 reason**：`'provider-switch' | 'key-reset' | 'manual'`
- **mini snap 阈值**：`MINI_SNAP_VISIBLE_PX` 60 → 180（之前 1/4 屏太严格根本收不起来）
- **keyState 多 provider 化**：基于 `currentProviderKeys` map，任一非空即 ready
- **`web_search.max_results` schema**：string → number（保留 string 兼容旧 schema）
- **`move_file.overwrite` schema**：string → boolean
- **截屏改 JPEG q85 + 1920px 长边 cap**：PNG 5MB 撞 Anthropic 上限
- **Settings provider card 3-state**：配 key + 切当前 + 选 model 一气呵成

### 修复
- `setModel()` 漏调 `broadcastSelectedModelState()` 导致 tray 切完 pill 不更新
- `ENOTEMPTY` 删除非空目录报错改成中文友好提示 + 建议 `run_command rm -r`
- `delete_file` schema 缺 `required: []` 引发的 TS2741
- `toolContext.selectedModel` 跟 fallback target 对齐
- msg-tool 卡 stuck / empty-response / 去重 3 个气泡渲染 bug
- pet drag 出屏消失

### 移除
- `prefs:set-model` IPC handler + preload `setModel` API + `ModelId` import
- `prefsSnapshot()` 返回里的 `modelId`
- 内部 legacy 镜像变量 `currentApiKey`（被 `getAnthropicKeyForClassifier()` 替代）

### 项目治理
- 新增 `CLAUDE.md`（项目宪法）— H1-H5 诚实条款 + W1-W8 工作流 + C1-C6 代码 + A1-A6 Agent + S1-S5 安全

### 已知问题
- 未做 codesign / notarization，首次启动需脱 Gatekeeper（install.sh 自动处理）
- Windows / Linux 安装包未构建
- auto-updater 未接入 GitHub Releases provider

---

## [0.3.7] — 2026-05-18

### 修复
- `get_weather` 串联三处修：undici fetch + IPv4-only agent 绕 macOS Happy Eyeballs ETIMEDOUT
- system prompt 强化禁止 AI 编"API 不可用"

### 变更
- 移除 `agenticEnabled` vision gate — 所有 tool 不再因 vision 关闭而失效

## [0.3.6] — 2026-05-18

### 新增
- `get_weather` tool

## [0.3.5] — 2026-05-18

### 新增
- system prompt 注入当前时间，pet 有时间观念

## [0.3.4] — 2026-05-18

### 修复
- 长时间不用 / 屏幕休眠后 pet 消失

## [0.3.3] — 2026-05-18

### 修复
- 空 content message 污染 chatHistory 导致 Anthropic 400

## [0.3.2] — 2026-05-18

### 修复
- 多 provider onboarding 流程
- `No output generated` 兜底处理

## [0.3.1] — 2026-05-18

### 新增
- Tray 屏幕感知 toggle
- 简化 vision consent modal

## [0.3.0] — 2026-05-18

### 新增
- 文档生成 tool 三件套：`write_docx` / `write_xlsx` / `write_pdf`

### 修复
- 三个 bug 同 commit：
  - 文档 tool 没暴露给 AI
  - 思考过早停（adaptive thinking）
  - 分身 bug 复发

---

## [0.2.0] — 2026-05-17

### 新增
- **M9-5 Mini mode 完整版**：drag-snap to edge + tray toggle + petMode 持久化
- **M9-5b B-3/4/5c**：进 mini 强制关 chat / hover-peek 平滑滑出 / 周期 micro-peek "我还活着"探头
- vision-service `view_screen` 触发降级到模糊视觉信号也调

### 修复
- single-instance lock 跳过 dev 模式（避免 hot-restart 死锁）
- `view_screen` 截图返回 type `'file-data'` → `'image-data'`
- 分身 bug + `MINI_VISIBLE_PX` 24 → 32

## [0.1.1] — 2026-05-17

### 新增
- **M8**：sleep timer（60s idle）+ AI 控制 pet 动画（`set_pet_animation` tool）
- **M9-1**：Pointer Capture drag（修快甩丢拽）
- **M9-2**：Click reactions（双击 poke / 4 连击 startled）
- **M9-3**：Sleep sequence 多阶段（yawn → doze → collapse → sleep + waking）+ pointerdown 立即唤醒
- **M9-4**：Eye tracking + body lean + shadow stretch（装 `vite-plugin-svgr`）

### 修复
- Haiku 4.5 + Anthropic specialized tool → "No output generated" hotfix

## [0.1.0] — 2026-05-17

### 新增（multi-provider major refactor）
- **6-provider foundation**：anthropic / openai / google / xai / deepseek / bytedance（基于 Vercel AI SDK）
- **AI SDK ToolSet + 多 provider streaming client**（取代直接调 `@anthropic-ai/sdk`）
- `currentProviderKeys` map + 启动加载 6 个 provider key
- `provider-key` / `selected-model` IPC channels
- Settings.tsx 6 provider 卡片 + cascade dropdown
- specialized provider tools（各家原生 web_search / code_execution）
- activity-classifier 切 AI SDK + hardcoded Haiku 4.5

### 变更
- preferences schema migration + selectedModel mirror
- chat-types 加 `@deprecated` 标记 + bridge re-export 旧符号
- 非-anthropic reset 对称化

### 修复
- vision IPC handlers race fix

### 移除
- `anthropic.ts` + `@anthropic-ai/sdk` 依赖（被 AI SDK 替代）

---

## [0.0.1] — 2026-05-15

### 新增（项目初始）
- monorepo 骨架：`01-桌宠客户端` / `02-视觉功能` / `03-非LLM视觉服务` / `00-总体方案`
- **桌宠客户端**（Electron + React + TS）：
  - M0：透明置顶窗口骨架
  - M0.5：真·小螃蟹 + 点拖混合交互
  - M1：状态机 + IPC + inline SVG 动画 + Space 跨越；M1-6 系统托盘菜单；M1-7 点击穿透 + 全屏跨越保活；M1-8 对话气泡 UI + 像素风 + cr 三轮修复
  - M2-1 ~ M3-3：累计功能 + cr 健壮性补丁
  - M1-2 主题加载器 + M3-3-E~I 累计
  - M4-A vision pivot：截屏 + OCR prefix → Claude vision → tool use agentic
  - M4-B agentic tools：`read_clipboard` / `open_url` / `copy` / `app_info`
  - M4-C/D agentic tools 全套：fs + 终端 + 网络 + Tavily UI
  - M5 设置面板（独立 BrowserWindow + 5 section）
  - M5-2/3/4：跨会话记忆 + 用户档案 wizard + inline 编辑
  - M6 Phase 1：`curl|bash` 终端一键装 + GitHub Releases zip 发布
  - provider 自动 fallback chain（Anthropic 529 → 切下家）+ classifyError 重试机制硬化
  - `move_file` tool（整理文件 first-class）
- **vision-service**（独立 Python 服务）：
  - M4-A-1 服务硬化：raw-bytes upload + `pet_bbox` + Caddy / Let's Encrypt
  - `_mask_pet_region` 像素精度 + P/CMYK 模式兼容
  - systemd drop-in 修 reload + acme_ca 锁定 LE + LimitCORE=0 防 core dump
- README 英文化 + monorepo root README + MIT LICENSE（含 clawd AGPL 隔离说明）
- install.sh bash 3.2 `set -u` 兼容修

[Unreleased]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.4...HEAD
[0.4.4]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.1...v0.4.3
[0.4.2]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.7...v0.4.0
[0.3.7]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Ice-teapop/desktop-pet/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Ice-teapop/desktop-pet/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Ice-teapop/desktop-pet/releases/tag/v0.2.0
[0.1.1]: https://github.com/Ice-teapop/desktop-pet/commit/197cd84
[0.1.0]: https://github.com/Ice-teapop/desktop-pet/commit/1f16f94
[0.0.1]: https://github.com/Ice-teapop/desktop-pet/commit/cce844a
