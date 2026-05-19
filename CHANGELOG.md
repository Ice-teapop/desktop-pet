# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 文档
- 新增 `CONTEXT.md`（领域术语表）+ `docs/adr/` 目录（ADR-0001 / ADR-0002）+ 本 CHANGELOG

---

## [0.4.0] — 2026-05-18

### 新增
- **批量工具变体**：`delete_file.paths[]`（≤50）/ `write_file.files[]`（≤30）/ `move_file.moves[]`（≤50），AI 一次请求一次审批
- **approval modal 队列**：renderer 侧 `approvalQueue: ApprovalRequest[]`，并发请求按序展示，不丢
- **approval:displayed ACK**：60s 自动 deny 倒计时改在 renderer 真正显示后才启动（防 modal 还没出来就 deny）
- **OpenAI native tools 模型白名单**：`OPENAI_NATIVE_TOOL_ALLOWED_FAMILIES = ['gpt-4o', 'gpt-4.1']`，其他不注入
- **拖文件喂上下文**：renderer 拖文件到气泡，主进程接收路径列表 → 注入对话
- **动态 listModels**：`available-models` channel，Settings 实时同步真实可用模型列表

### 变更
- **selected-model 单一事实源**：`prefs:state.modelId` 删除，model state 只走 `selected-model:state`（详见 ADR-0001）
- **模型热切换两档**：同 provider 同 tool capability → 软切（不打断旧响应）；跨 provider → 硬切（清历史 + 系统气泡）（详见 ADR-0002）
- **`chat:history-cleared` 事件加 reason**：`'provider-switch' | 'key-reset' | 'manual'`，renderer 只对 provider-switch 加系统气泡
- **mini snap 阈值**：`MINI_SNAP_VISIBLE_PX` 60 → 180（之前 1/4 屏太严格，根本收不起来）
- **keyState 多 provider 化**：基于 `currentProviderKeys` map，任一非空即 ready（之前只看 Anthropic）
- **`web_search.max_results` schema**：string → number（保留 string 兼容旧 schema）
- **`move_file.overwrite` schema**：string → boolean

### 修复
- `setModel()` 漏调 `broadcastSelectedModelState()` 导致 tray 切完 pill 不更新
- `ENOTEMPTY` 删除非空目录报错改成中文友好提示 + 建议 `run_command rm -r`
- `delete_file` schema 缺 `required: []` 引发的 TS2741

### 移除
- `prefs:set-model` IPC handler
- preload `setModel` API + `ModelId` import
- `prefsSnapshot()` 返回里的 `modelId`
- 内部 legacy 镜像变量 `currentApiKey`（被 `getAnthropicKeyForClassifier()` helper 替代）

### 项目治理
- 新增 `CLAUDE.md`（项目宪法）— H1-H5 诚实条款 + W1-W8 工作流 + C1-C6 代码 + A1-A6 Agent + S1-S5 安全

### 已知问题
- 未做 codesign / notarization（Phase 2 仍待办），首次启动需 `xattr -d com.apple.quarantine` 脱 Gatekeeper（install.sh 自动处理）
- Windows / Linux 安装包未构建
- auto-updater 未接入 GitHub Releases provider，每次大版本需手动跑 install.sh

[Unreleased]: https://github.com/Ice-teapop/desktop-pet/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Ice-teapop/desktop-pet/releases/tag/v0.4.0
