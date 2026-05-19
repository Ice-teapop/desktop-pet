# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.1...HEAD
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
