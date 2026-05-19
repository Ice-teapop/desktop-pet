# ADR-0003: OpenAI code_interpreter container 生命周期

- **状态**: Accepted (current behavior); 完整 per-session pinning 推迟
- **日期**: 2026-05-19
- **决策者**: @han 询 + Claude 评估

## 背景

`openai.tools.codeInterpreter()`（AI SDK 包 OpenAI Responses API）在每次 tool call 起一个新 container（OpenAI 后端 Python sandbox）。Container 默认 `container: 'auto'` 模式：

- AI 调一次 → 起一个 fresh container
- ~20min idle → OpenAI 自动 GC
- 不可跨 turn 复用（每次新 container = 新 Python 进程 = 新文件系统 = 新 pip env）

之前重构清单里把这个标成"OpenAI container 收紧（防内存泄漏隐患）"，复盘后这个 framing 其实不准：

- **没有内存泄漏**：provider 自动 GC，DeskPet 不持 reference
- **没有费用泄漏**：containers 是 pay-per-use seconds，停止用就停止计费
- **没有安全风险**：container 跑在 OpenAI 沙箱，跟用户本机文件系统隔离（跟 `run_command` 不同）

真正的痛点是 **跨 turn UX**：

```
User: "分析这份 CSV"
AI: [code_interpreter] 加载 → 分析 → 答
User: "再画个柱状图"
AI: [code_interpreter] container 已 GC → 重新加载 CSV → 重新分析 → 画图
```

第二轮 AI 没有上一轮的 dataframe 引用，要全 redo。这是 UX 限制，不是 bug。

## 决策

**当前 ship**：维持 `container: 'auto'` 行为，**只在代码里显式写出来**，让意图可见、未来 reviewer 不需要回头看 SDK 默认值。

**完整 per-session pinning** 推迟，原因：

1. **需要 OpenAI REST 直调**：AI SDK 没暴露 `containers.create()` / `containers.del()` 端点；要手撸 `POST /v1/containers` + `DELETE /v1/containers/<id>`
2. **状态跟踪复杂**：要在 main 持 `openaiContainerId: string | null`，跨 chat:submit 透传；`applySelectedModel` 跨 provider 切要清；app quit 要 fire-and-forget DELETE
3. **测试需要真实 quota**：本地实现完无法验证（用户 OpenAI 账户 quota 已耗尽 2026-05-18），不愿盲推未验证代码

## 备选方案

**A. 完整 per-session container pinning（推迟）**
- 起 session 时 lazy create 一个 container
- 每次 buildSpecializedToolsForProvider 传 `container: <id>`
- chat-history-cleared / provider-switch / app quit 时 fire-and-forget DELETE
- 估时 2-3h + 真实 OpenAI quota 验证

**B. 用 AI SDK tool-result 事件捕获 container_id 反向 pin（推迟）**
- 第一次 code_interpreter call 让 OpenAI 自动建 container，从 tool-result 抓 containerId
- 下次 ToolSet build 把 containerId 传回去
- 比 A 省掉 pre-create 一次 HTTP，但 SDK 是否暴露 tool-result.result.containerId 待验证

**C. 不修（status quo）**
- 当前行为：每次 fresh container，UX 限制为代价换"零运维复杂度"
- 否决理由：用户上 "再画个图" 经常踩，痛感真实

选 C 暂时 ship；A / B 等下次有真实 OpenAI 测试通道时再做。

## 后果

**正面**：
- 代码意图可见（`container: 'auto'` 不再隐式）
- 留 ADR 给未来 reviewer，省一次"这是 leak 吗？是 bug 吗？"的考古

**负面 / 已知限制**：
- AI 跨 turn 不记得上一轮 code_interpreter 状态 — 用户要重新喂数据
- 没有 explicit cleanup — 靠 OpenAI 20min idle GC，万一未来 OpenAI 改成"永不 GC 直到删除"我们会变成 hoarder

**警惕**：
- 如果后续真做 A 方案，记得在 `applySelectedModel` 跨 provider 分支加 container 清理逻辑（已有 chat-history clear 钩子可借）
- DELETE 要 fire-and-forget（don't block UI），但要记 audit log 避免 silent leak
