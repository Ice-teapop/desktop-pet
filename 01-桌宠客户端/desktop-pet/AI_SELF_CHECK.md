# DeskPet-Furina AI Maintenance Self-Check

这份文档是给任何接手本项目的 AI / agent 的快速上手自检入口。目标不是替代源码阅读，而是防止一上来改错路径、漏掉跨进程契约、或者做完不验证。

## 0. 先确认你在改对项目

- 活跃客户端路径是 `01-桌宠客户端/desktop-pet/`。
- 不要把 `03-非LLM视觉服务/` 当成当前桌宠主线；它是旧视觉服务方向。
- 运行时数据真实路径由 Electron `productName` 决定，当前 live userData 是 `~/Library/Application Support/DeskPet-Furina/`。
- 当前主题是 `themes/deskpet-furina/`，主题元数据是 `themes/deskpet-furina/theme.json`。
- 当前渲染方案已经移除眼睛 overlay / wizard eye-following 图层。不要把旧眼睛图层作为修复方向重新加回来。

进入工作前先跑：

```bash
git status --short
```

如果工作区已有改动，先区分哪些是用户改动、哪些是你本轮改动。不要回滚你没有亲自制造的改动。

## 1. 必读文件顺序

先读根入口，再按你要改的模块读局部说明：

1. `AI_SELF_CHECK.md`，也就是本文档。
2. `package.json`，确认命令、依赖、产品名和版本。
3. `README.md`，确认用户侧功能和开发命令，但注意它可能有版本漂移。
4. `src/main/llm/CODEX.md`，如果改 LLM、tool、provider、审批、安全。
5. `src/renderer/src/CODEX.md`，如果改桌宠 UI、chat UI、状态订阅、动画渲染。
6. `src/shared/CODEX.md`，如果改跨进程类型、状态枚举、错误类型、i18n key。
7. 相关源码文件。不要只读文档就改。

## 2. 架构地图

| 区域                  | 责任                                                                  | 入口                                                             |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Main process          | Electron 窗口、托盘、IPC、状态机、LLM 调用、存储、安全审批            | `src/main/index.ts`                                              |
| State machine         | theme.json driven 的 A/B/C 状态切换、别名兼容、idle eggs              | `src/main/state-machine.ts`                                      |
| LLM client            | AI SDK streaming、多 provider fallback、连续 tool loop、错误归类      | `src/main/llm/llm-client.ts`                                     |
| Tool schemas          | AI SDK `ToolSet` / Zod schema / model output adapter                  | `src/main/llm/tool-defs.ts`                                      |
| Tool runtime          | 真实副作用、path safety、approval、audit、文件/命令/网络工具          | `src/main/llm/tools.ts`                                          |
| Provider/native tools | 各 provider model 能力和 server-side tool gate                        | `src/main/llm/providers.ts`, `src/main/llm/specialized-tools.ts` |
| Preload contract      | renderer 可见的 IPC 白名单和 TS 类型                                  | `src/preload/index.ts`, `src/preload/index.d.ts`                 |
| Renderer              | 桌宠渲染、chat UI、settings UI、tool card、pet state subscription     | `src/renderer/src/App.tsx`, `src/renderer/src/Settings.tsx`      |
| Shared contracts      | ChatError、ToolEvent、PetState、Provider、i18n、display label         | `src/shared/`                                                    |
| Storage               | safeStorage keys、preferences、history、memory、profile、theme loader | `src/main/storage/`                                              |
| Theme assets          | Furina SVG/SMIL 动画、theme manifest                                  | `themes/deskpet-furina/`                                         |

## 3. 改动路由表

| 你要改什么                               | 先看                                                                                        | 常见联动                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 连续 tool 调用 / tool 卡片 / tool error  | `src/main/llm/CODEX.md`, `llm-client.ts`, `tool-defs.ts`, `tools.ts`                        | `shared/chat-types.ts`, `renderer App.tsx`, zh/en i18n   |
| 新增/修改本地 tool                       | `tools.ts`, `tool-defs.ts`, `system-prompts.ts`                                             | path safety、approval、audit log、Settings 文案          |
| Provider / model / native tool           | `provider-types.ts`, `providers.ts`, `specialized-tools.ts`, `available-models.ts`          | fallback chain、selected model storage、Settings         |
| 桌宠状态 / 动画 / sleep/wake             | `theme.json`, `pet-state.ts`, `state-machine.ts`, renderer `STATE_GIF`                      | tool schema 中的 `PET_ANIMATIONS`, mini/full render path |
| IPC state 同步                           | `main/index.ts`, `preload/index.ts`, `preload/index.d.ts`, renderer useEffect               | 必须保持 subscribe-first then request-state              |
| API key / Tavily / user profile / memory | `src/main/storage/`, `Settings.tsx`, `system-prompts.ts`                                    | userData 路径、safeStorage、i18n                         |
| 窗口、mini mode、拖拽、跨 Space          | `main/index.ts`, `App.tsx`, `.careful-coder/notes/project-context.md`                       | NSPanel、screen-saver level、bounds clamp、watchdog      |
| UI 样式                                  | `assets/main.css`, `assets/settings.css`, `themes/deskpet-furina/furina-royal-chat-v1.html` | 不要无意改状态逻辑                                       |
| 打包发布                                 | `package.json`, `electron-builder.yml`, `electron.vite.config.ts`                           | productName/userData 分流、build 脚本                    |

## 4. 改代码前自检

每次动手前回答这 6 个问题：

1. 我改的是活跃客户端 `01-桌宠客户端/desktop-pet/` 吗？
2. 这个改动是否跨 main / preload / renderer / shared contract？如果是，四边都读了吗？
3. 有没有 runtime 数据或用户隐私影响？例如 safeStorage、audit、chat history、pet-memory、user-profile。
4. 有没有 tool side effect？如果有，是否仍然经过 `executeTool`、path safety、approval、audit。
5. 有没有视觉/状态资产影响？如果有，是否同步 `theme.json`、`pet-state.ts`、`STATE_GIF`。
6. 有没有启动竞态？renderer 是否先订阅 `onX(...)`，再调用 `requestXState()`。

如果其中任何一个答案不确定，先读代码或问用户，不要靠猜。

## 5. 模块级硬规则

### LLM tool loop

- `MAX_TOOL_STEPS` 是连续 tool 调用安全刹车。改它时必须同步 `ChatError`、renderer `chatErrorText`、zh/en i18n。
- `view_screen` 的图片输出在 AI SDK v6 中应保持 `{ type: 'image-data', data, mediaType }`。不要改回 `file-data`。
- `tools.ts` 的 runtime validation 不能因为 `tool-defs.ts` 已经有 Zod schema 就删掉。
- `write_docx` 必须拒绝空 title / empty sections / empty paragraphs 的空文档占位。
- 新增高风险 tool 时，必须考虑 path safety、approval modal、audit log、系统 prompt 描述。

### Renderer / IPC

- tool card 以 `ToolEvent.toolCallId` 匹配。重复 `start` 不能插入第二张 running 卡。
- 新 submit 或 chat error 前要清掉 still-running tool card；abort 不一定有 `tool-result`。
- 任何新的 state push 都要有 request-state 兜底，防 `did-finish-load` 早于 React effect。
- 不要把 full-mode idle cursor follow 逻辑绑到 mini-mode。

### Pet state / theme

- `theme.json` 描述状态语义；`state-machine.ts` 消费它；renderer 仍需要自己 import SVG 并在 `STATE_GIF` 映射。
- `thinking` 由 chat flow 自动设置，不应暴露为 public `set_pet_animation` 选项。
- 删除 legacy alias 前先 grep theme JSON、renderer `STATE_GIF`、tool schema、system prompt。
- A/B/C 语义不能混：A 循环、B 自动回 `returnTo`、C 过渡并锁住内部推进。

### Storage / userData

- API keys 和 Tavily key 用 Electron `safeStorage`，不要写明文。
- `audit.log`、`chat-history.json`、`pet-memory.md`、`user-profile.json` 都在 userData 下。
- 改 productName、app name 或 locale 分流时，必须重新核对 userData 路径和 migration。
- 不要把用户真实 key、memory、history 内容写进 repo 文档或测试 fixture。

## 6. 常见故障快速定位

| 现象                            | 第一检查点                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| AI 一直没有回复，只看到 tool 卡 | `llm-client.ts` 的 fullStream、`tool-loop-limit`、renderer tool card sweep         |
| tool 卡一直 spinning            | `ToolEvent.toolCallId` 是否匹配，abort/error 是否 sweep running cards              |
| 截屏 tool 说看不到图            | `tool-defs.ts` 的 `toModelOutput` 是否仍用 `image-data`                            |
| 新 tool 不弹审批或无 audit      | 是否绕过 `executeTool`，是否漏 `requestApproval` / `logToolAction`                 |
| 重启又问 API key                | productName/userData 路径，`provider-keys.ts`，migration                           |
| 前台 App 切换后状态错乱         | `ActiveAppMonitor` 回调顺序、activity sequence guard、`pet:request-activity-state` |
| mini 卡在屏幕中间或 chat 打不开 | `setPetMode`, `computeModeBounds`, mini pointerup restore, chat setBounds          |
| 睡眠/唤醒卡住                   | `state-machine.ts` C lock、内部 timer，不要用外部 gate 卡内部推进                  |
| 视觉出现分身/残影               | inline SVG、overflow、will-change、透明窗口 stale layer；不要重加双层 crossfade    |
| i18n 显示 key 名                | zh/en 是否都补齐，对应 `t(...)` key 是否存在                                       |

## 7. 验证矩阵

最小验证：

```bash
npx eslint . --quiet
npm run typecheck
```

完整静态验证：

```bash
npm run lint
```

当前已知状态：完整 lint 允许有 Prettier warnings，但必须是 `0 errors`。不要因为修一个小逻辑顺手跑全仓 `npm run format`，除非用户明确同意格式化 sweep；它会制造很大的无关 diff。

运行验证：

```bash
npm run dev
```

fresh dev restart 成功时至少要看到：

```text
electron main process built successfully
electron preload scripts built successfully
dev server running for the electron renderer process
starting electron app...
```

验证完成后停掉 dev 进程，不要留下后台 Electron / electron-vite。

## 8. 变更类型对应验收

| 改动类型          | 必跑                                                       | 额外检查                                    |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------- |
| 纯文档            | 重新读文档，检查路径/命令真实存在                          | 可选 `npx prettier --check <file>`          |
| shared type / IPC | `npx eslint . --quiet`, `npm run typecheck`                | main/preload/renderer 三边 grep             |
| LLM/tool          | `npx eslint . --quiet`, `npm run typecheck`, `npm run dev` | 模拟成功、失败、abort、step cap             |
| Storage/security  | `npm run typecheck`, `npm run dev`                         | userData 路径、权限、敏感内容不入日志       |
| Pet state/render  | `npm run typecheck`, `npm run dev`                         | full/mini、idle、sleep/wake、tool animation |
| Build/release     | `npm run build`                                            | 产物路径、productName、locale 分流          |

## 9. 完成前最后自检

交付前确认：

- diff 只包含本任务相关文件。
- 没有回滚用户已有改动。
- 没有新增 secret、绝对个人路径、临时 debug log。
- 新增 `ChatError.kind`、IPC channel、PetState、i18n key 都完成跨文件同步。
- 新增长期维护规则时，更新对应的 `CODEX.md` 或本文档。
- 最终回复包含真实验证结果，不把“应该能跑”说成“已验证”。

## 10. 何时更新本文档

满足任一条件就更新：

- 新增跨进程 contract。
- 改变 LLM tool loop、approval、安全边界。
- 改变主题状态语义、mini/full render path、userData 路径。
- 引入新的验证命令或废弃旧命令。
- 发现一个会让后续 AI 反复踩坑的新故障模式。
