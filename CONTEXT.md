# DeskPet 领域语言

新 agent 进来先读这页 — 仓里出现的术语对应的概念定义，避免名字漂移。

代码细节去看 `01-桌宠客户端/desktop-pet/src/`；这页只解释"东西是什么"，不解释"代码在哪"。

---

## 1. 桌宠 / Pet

| 术语 | 定义 |
|---|---|
| **DeskPet** | 整个产品代号 = 客户端 + 视觉服务 + 总体方案三块的集合 |
| **客户端 / desktop-pet** | `01-桌宠客户端/desktop-pet/` — Electron + React 主程序，用户直接交互的那个 |
| **视觉服务 / vision-service** | `03-非LLM视觉服务/vision-service/` — 独立 Python 服务，桌宠通过 IPC/HTTP 喂截图过来做识别 |
| **桌宠角色 / pet character** | 用户屏幕上飘的那个像素小人。透明 BrowserWindow + React 渲染 |
| **pet-state** | 角色当前的"行为状态"（idle / poked / startled / wake / drag 等），驱动动画 |
| **pet-mode** | 角色当前的"摆放模式"（normal vs mini）。跟 pet-state 是两个独立维度 |
| **mini mode / 收起** | 桌宠贴到屏幕边缘后只露半个身子的形态。触发阈值 `MINI_SNAP_VISIBLE_PX = 180` |
| **钉 / pin / follow front app** | 桌宠跟随当前前台 app 窗口移动（vs 自由飘浮） |
| **拖拽 / drag** | 鼠标按住桌宠移动；松手离屏幕边 < 180px 进 mini |

## 2. 对话 / Chat

| 术语 | 定义 |
|---|---|
| **对话气泡 / chat bubble** | 桌宠头上飘出的对话框，渲染 LLM 输出 |
| **chat window** | 独立的 BrowserWindow（不是 in-renderer modal），承载气泡 UI |
| **chunk** | LLM 流式输出的一段 token，通过 IPC 推给 renderer |
| **chat:history-cleared** | 主进程清历史时发的广播事件，带 `reason: 'provider-switch' \| 'key-reset' \| 'manual'` |
| **系统气泡 / system bubble** | 非 LLM 输出的提示气泡（如 `( openai 过载, 已切到 anthropic )`） |
| **chatTurnToken** | 每轮对话的递增计数，跨 turn 拒绝旧响应（防 race） |

## 3. AI Provider / 模型

| 术语 | 定义 |
|---|---|
| **provider** | LLM 厂商。当前 6 家：`anthropic` / `openai` / `google` / `xai` / `deepseek` / `bytedance` |
| **selected-model** | `{provider, modelId}` 元组 — 当前选中的模型。单一事实来源走 `selected-model:state` channel |
| **keyState** | 单一 boolean — 任一 provider 有 key 即 ready，gates 输入框是否可用 |
| **provider-key** | 每个 provider 独立存的 API key，safeStorage 加密落盘 |
| **fallback chain** | 当前 provider 过载/限流/空回复时自动切到下一个有 key 的 provider |
| **lastErrKind** | 上次失败的语义类型（`overloaded` / `rate-limited` / `empty-response`），决定气泡文案 |
| **soft switch** | 同 provider 同 tool capability 换模型 — 不打断旧响应，新消息用新模型 |
| **hard switch** | 跨 provider 或 tool capability 不同 — 清历史 + 系统气泡告知 |

## 4. Tool / 工具

| 术语 | 定义 |
|---|---|
| **tool (LLM 视角)** | LLM 通过 function calling 调用的能力。**不是** UI tooltip / 不是 OS 工具 |
| **specialized tools / native tools** | 厂商服务端自带的工具（Anthropic `web_search_20260209` / `code_execution_20260120`，OpenAI `webSearchPreview` / `codeInterpreter`），不走我们 IPC |
| **app tools** | 我们自己实现的工具：`read_file` / `write_file` / `delete_file` / `move_file` / `run_command` / `web_search`（Tavily 实现）等 |
| **batch tool** | 支持一次传多条的工具变体。`paths[]` (delete) / `files[{path,content}]` (write) / `moves[{src,dest}]` (move)。配额 50/30/50 |
| **approval / 审批** | 危险工具调用前弹给用户确认的 modal。审批通过才执行 |
| **approval queue** | renderer 侧维护的 `ApprovalRequest[]`，并发请求按序展示 |
| **trust-dir** | 用户在 approval 时勾选"以后不再问"的目录。两档：`session`（关机丢）/ `persistent`（落盘） |
| **audit log** | 所有工具调用的 append-only JSON 日志，带 batch_id 关联批操作 |
| **path safety** | 默认信任 `$HOME` 下、黑名单（`.ssh` `.aws` 等）外；其他要 approval |

## 5. 存储 / Persistence

| 术语 | 定义 |
|---|---|
| **preferences.json** | 普通偏好（followFrontApp / useFastPath / vision*）。**不存 modelId**（PR-4 改） |
| **trusted-dirs.json** | persistent trust 目录落盘文件 |
| **audit.jsonl** | 工具调用审计日志，append-only |
| **memory.md** | 用户跨会话记忆（用户档案 + 长期 fact），LLM 系统 prompt 注入 |
| **safeStorage** | Electron 原生加密 API，用于 provider key 落盘 |

## 6. IPC 关键 channel

| Channel | 方向 | 用途 |
|---|---|---|
| `chat:submit` | R→M | 用户提交输入 |
| `chat:chunk` | M→R | 流式 token |
| `chat:done` | M→R | 一轮结束（带 usage） |
| `chat:history-cleared` | M→R | 历史清空通知（带 reason） |
| `selected-model:state` | M→R | 当前选中模型推送（唯一事实来源） |
| `selected-model:set` | R→M | 切换模型请求 |
| `provider-key:state` | M→R | 各 provider key 状态聚合 |
| `keyState` | M→R | 派生的 single boolean（任一 key 存在） |
| `approval:request` | M→R | 弹审批 modal |
| `approval:response` | R→M | 用户决定 |
| `approval:displayed` | R→M | renderer 确认 modal 已显示（启动 60s 自动 deny 倒计时） |
| `available-models` | M→R | 动态 listModels 结果（v0.4.0 新加） |

## 7. 项目专用缩写

| 缩写 | 全称 |
|---|---|
| **M4 / M5 / M6...** | Milestone 编号（roadmap 阶段） |
| **M9-2/3/4/5** | M9 子任务（click reactions / wake hook / eye tracking / mini mode） |
| **PR-4** | "selected-model 单事实源" 重构编号（v0.4.0 内部） |
| **W1-W8** | CLAUDE.md 工作流条款 |
| **H1-H5** | CLAUDE.md 诚实条款 |
| **C1-C6 / A1-A6 / S1-S5** | CLAUDE.md 代码/Agent/安全条款 |
