# DeskPet-Furina — 完整开发概览

> 这份文档是 DeskPet-Furina 的**单文件开发参考** —— 架构 / 待办 / tool 逻辑 / 人设 / skill 框架 / 主题 / 发布流程 / 开发约定全在这。新 agent / 新人接手先读这页。
>
> 终端用户向导 → 根 `README.md`。AI 行为宪法 → `CLAUDE.md`。领域术语 → `CONTEXT.md`。架构决策 → `docs/adr/`。

---

## 1. 项目定位

- **是什么**：Fork from `Ice-teapop/desktop-pet` v0.4.17，替换 sprite 形象为**芙宁娜 chibi 立绘**，重写 persona 默认调性。
- **不是什么**：不是主线 desktop-pet。功能、tool 集合、状态机理论上**继承主线**，主要差异在：
  - 形象（deskpet-furina theme）
  - persona 默认 (`furina-companion` 友/恋人语气，可在设置里切回 furina-god/actor 戏剧腔)
  - productName 改名 (`DeskPet-Furina` / appId `com.deskpet.furina`)
- **fork 定位**：自托管视觉服务路径（`03-非LLM视觉服务/`）原计划，M4-A pivot 后已废弃 → 现在跟主线一样走 LLM provider vision endpoint。

---

## 2. 顶层板块

```
DeskPet-Furina/
├── 00-总体方案/                ← 产品设计 docx + 生成脚本
├── 01-桌宠客户端/desktop-pet/  ★ 核心 Electron + React 19 + TS
├── 02-视觉功能/                ← Phase 2 文档冻结，实装未启动
├── 03-非LLM视觉服务/           ← 已 DEPRECATED (M4-A pivot 后死目录)
├── docs/                       ← ADR + 本 OVERVIEW
├── report/                     ← cc-cr 历史可视化 HTML
├── scripts/install.sh          ← 一键安装脚本
├── CLAUDE.md                   ← AI 行为宪法
├── CONTEXT.md                  ← 领域术语词典
└── README.md                   ← 用户向导 (install / features)
```

---

## 3. 客户端 (01-桌宠客户端/desktop-pet/) 模块

### 主进程 `src/main/`

| 模块 | 文件 | 职责 |
|---|---|---|
| **入口** | `index.ts` (~2500 行 ⚠️) | bootstrap / IPC 注册 / 状态机驱动 / chat:submit dispatcher |
| **状态机** | `state-machine.ts` | A/B/C 三类 priority gate；ALIAS_MAP；setState 公开入口 |
| **LLM 客户端** | `llm/llm-client.ts` | AI SDK `streamText` + tool loop (MAX_TOOL_STEPS=15) |
| **Providers** | `llm/providers.ts` | 6 家 createXxx 工厂 + DeepSeek R1 reasoning middleware |
| **Tool 定义** | `llm/tool-defs.ts` | Zod schema + AI SDK ToolSet wrapper |
| **Tool 执行器** | `llm/tools.ts` (~2750 行 ⚠️) | 19 个 exec* + dispatcher + ToolContext |
| **Specialized tools** | `llm/specialized-tools.ts` | 每个 provider 的 native server-side tool (anthropic web_search / openai code_interpreter / 等) |
| **Path 安全** | `llm/path-safety.ts` | HOME 默认信任 + 黑名单 (.ssh / .aws / Keychain) + symlink resolve |
| **Command 白名单** | `llm/command-whitelist.ts` | 58 safe regex + 23 hard-deny (rm -rf / sudo / curl\|sh / dd) |
| **Approval** | `llm/approval.ts` | 4 档 modal IPC (deny / once / trust-session / trust-permanent) |
| **System prompts** | `llm/system-prompts.ts` | ZH/EN system prompt + persona preamble + skill 注入 + 用户档案段 |
| **Skill loader** | `llm/skill-loader.ts` ⭐ | dev-curated `.md` skills loader (Vite `?raw` 内联) |
| **Skills 池** | `llm/skills/*.md` ⭐ | pdf-summary / code-review / daily-brief 模板 |
| **Services** | `services/{active-app, screen-capture, vision-pipeline, dropped-files, settings-window, update-check}.ts` | 前台 app 监听 / 截屏 / 拖文件 / 设置窗 / 更新检查 |
| **Storage** | `storage/{chat-history, preferences, provider-keys, pet-memory, user-profile, tavily-key, credentials, migration, theme}.ts` | safeStorage 加密 + JSON 持久化 |
| **Audit log** | `audit-log.ts` | JSONL append-only / 5MB 滚动 / chmod 600 / 不上传 |

### Preload `src/preload/`

- `index.ts` — contextBridge 暴露 ~60 个白名单 API (`window.api.*`)
- `index.d.ts` — TS 类型

### Renderer `src/renderer/`

| 文件 | 职责 |
|---|---|
| `main.tsx` | 入口 + hash route (`#settings` → Settings vs 默认 → App) |
| `App.tsx` (~1700 行 ⚠️) | 桌宠 sprite / chat panel / approval modal / vision pill / wizard 等全部 React 组件 |
| `Settings.tsx` | 独立设置窗 (key / model / 信任目录 / 审计 / memory / profile) |
| `assets/main.css` (~1200 行) | 桌宠 + Royal Salon chat 主题 |
| `assets/settings.css` (~440 行) | Settings royal 主题 |

### Shared `src/shared/`

| 文件 | 出口 |
|---|---|
| `pet-state.ts` | `PetState` / `PetAnimation` / `LEGACY_ALIAS_NAMES` / `RENDERER_FADE_HALF_MS` |
| `pet-mode.ts` | `PetMode` + 同轴常量 (`MINI_WIN_*` / `DRAG_MIN_VISIBLE_PX` / `MINI_SNAP_*`) |
| `theme-types.ts` | `ThemeStateDef` / `StatePriority` |
| `chat-types.ts` | `ChatError` / `KeyState` / `ActivityState` / `ToolEvent` / `ChatHistoryClearedEvent` |
| `provider-types.ts` | `Provider` (6 家) / `SelectedModel` / `PROVIDERS` registry / `PROVIDER_ORDER` |
| `settings-types.ts` | `PrefsState` / `TrustedDirsState` |
| `user-profile-types.ts` | `UserProfile` / `PersonaPreset` / `PERSONA_PRESET_*` |
| `approval-types.ts` | `ApprovalRequest` / `ApprovalDecision` |
| `tool-display.ts` | `getToolDisplay(name)` — UI 显示映射 |
| `i18n/{zh,en}.ts` | i18n 字符串表 |
| `vision-types.ts` | 视觉服务契约（client 端仍用，但服务端已 deprecated） |

### Theme assets `themes/`

- `deskpet-furina/` ⭐ active：`theme.json` (15 states / 3 transitions / 2 reactions / 3 idleEggs / 18 eventMap) + 25 SVG sprite + `furina-royal-chat-v1.html` (chat 主题 mockup)
- `deskpet-cc/` 备选：CC 螃蟹原创像素 sprite (历史保留，切换需改 `THEME_DIR` + 重启)

---

## 4. 核心数据流

### 用户发消息 → 桌宠回答

```
[Renderer] App.tsx 用户输入 Enter
   ├─ submitChat(text) → IPC chat:submit
   ▼
[Main] index.ts chat:submit handler
   ├─ chatHistory.push(user msg)
   ├─ stateMachine.setState('thinking')         # 桌宠切 thinking 动画
   ├─ 算 fallbackChain (PROVIDER_ORDER)
   └─ startStreamFromProvider(provider)
        ├─ instantiateModelSync(provider, key, modelId)
        ├─ new LlmClient(model, modelId, provider)
        └─ fbClient.stream(history, handlers, ctx)
             │  systemPrompt 组装:
             │    preamble (Furina 时宪法身份)
             │    + getSystemPrompt() (主体 ZH/EN)
             │    + renderCurrentTimeSection()
             │    + renderUserProfileSection(profile) (含 persona)
             │    + renderSkillsSection() (skill metadata)
             │    + petStateInjection()
             │    + memoryInjectionWrapper(memory)
             │
             ▼
        [AI SDK] streamText(model, messages, tools, stopWhen=stepCountIs(15))
             ├─ tool-call → tools.ts:executeTool dispatcher
             │     ├─ path-safety + command-whitelist 检查
             │     ├─ approval modal (高危)
             │     ├─ exec* 实装 (view_screen / read_file / run_command / load_skill / …)
             │     └─ audit-log 写 JSONL
             ├─ text chunk → IPC chat:chunk → [Renderer]
             └─ tool result wrapped as <external_content untrusted>
   ┌───────────────────────────────────────────────────┐
   │ onDone:                                           │
   │   chatHistory.push(assistant msg)                 │
   │   scheduleChatHistorySave (debounce 500ms)        │
   │   stateMachine.setState('happy')                  │
   │   IPC chat:done                                   │
   │ onError:                                          │
   │   overloaded/rate-limited + 未收 chunk →           │
   │     下一 provider 重试                              │
   │   invalid-api-key → clearProviderKey()            │
   │   stateMachine.setState('error')                  │
   └───────────────────────────────────────────────────┘
```

### 状态机 (A/B/C 类)

| 类型 | 语义 | 例子 | 行为 |
|---|---|---|---|
| **A** | 循环 | `idle / sleeping / typing / building / juggling / conducting / sweeping / carrying / thinking / error` | 进入即播，离开即停 |
| **B** | 回归 | `happy / notification / react-poke / idle-look / idle-yawn` | 播 `durMs` (默认 6s) 后自动回 `returnTo` |
| **C** | 过渡桥 | `collapse-sleep / wake / mini-enter` | **锁定状态**，播 `durMs` (Royal v1 100ms) 后切到 `to`；期间仅 Error 能抢占 |

**优先级 gate** (`shared/theme-types.ts`)：`Error > Notification > CBridge(锁) > Reaction > Working > IdleEgg > Idle`

**别名兼容**：`state-machine.ts:ALIAS_MAP` 7 条剩余 (`sleep / collapsing / waking / drag / yawning / dozing / working`) — cc 主题 fallback 用。其余 10 条已 Stage C 收掉，callers 全 canonical 化。

---

## 5. Tool 池 (19 个，已分级)

### 信息收集（无 modal / 静默执行）

| Tool | 描述 |
|---|---|
| `view_screen` | 截屏 → 当前 provider 的 vision 接口 |
| `read_clipboard` | 读剪贴板（含 prompt-injection armor） |
| `current_app_info` | 当前前台 app |
| `fetch_url` | HTTP GET（SSRF 防御 + 首次 host modal） |
| `web_search` | Tavily AI 搜索（需 Tavily key） |
| `get_weather` | Open-Meteo 当日 + 12h 预报（免 key） |
| `read_system_preference` | macOS `defaults` 读 (黑名单 Keychain / Mail / Safari) |

### 文件系统（HOME 顶级默认信任）

| Tool | 描述 |
|---|---|
| `read_file` | 读文件 + `<external_content>` armor |
| `list_directory` | 列目录 |
| `find_files` | 递归 glob 搜索 (DoS budget: 50k 条 / 5s) |
| `write_file` | 写/覆盖**纯文本/源代码/md/json/txt** |
| `write_docx` | Word 文档（`docx` npm 包，结构化 sections）— **加 totalChars>0 护栏防空文件** |
| `write_xlsx` | Excel 多 sheet |
| `write_pdf` | PDF (`pdfkit`)，中文走 macOS 系统字体 |
| `create_directory` | mkdir -p |
| `delete_file` | ⚠️ 永远弹 modal；先 trash, 失败弹 fallback "永久删除？" |
| `move_file` | 单/批量 mv |
| `copy_file` | 单/批量 cp |
| `organize_files` | macro: find+mkdir+batch-move 一键 |

### 终端

| Tool | 描述 |
|---|---|
| `run_command` | safe 白名单静默 / 其它弹 modal / 硬拒命令永久拒。**也用于 `open -a 'AppName'` 打开 macOS app** |

### 剪贴板 + 浏览器 + 系统

| Tool | 描述 |
|---|---|
| `copy_to_clipboard` | 写剪贴板 |
| `open_url` | shell.openExternal (http(s) only) |
| `open_system_settings` | 打开 macOS 设置某 pane |

### 记忆 + 用户档案

| Tool | 描述 |
|---|---|
| `remember` | 写跨会话长期 memory.md |
| `save_user_profile` | wizard 完成时存档 |

### 动画 + Skill

| Tool | 描述 |
|---|---|
| `set_pet_animation` | LLM 触发桌宠表演：`juggling / sweeping / conducting / carrying / happy` (5 个，不含 thinking——chat 自动设) |
| `load_skill` ⭐ | 拉取 dev-curated skill 完整指令 (按 name) |

---

## 6. 人设系统

### PersonaPreset 8 种

| key | label | 默认 | 风格 |
|---|---|---|---|
| `furina-companion` | 芙宁娜·身边密友 | ⭐ 默认 | 友/恋人语气，"我"自称，叫名字，撒娇 |
| `furina-god` | 芙宁娜·水神（戏剧期） |  | 戏剧腔，"本座"，叫"凡人/子民"，自负浮夸，软肋马卡龙/起泡水 |
| `furina-actor` | 芙宁娜·演员（卸神后） |  | 卸 façade 真心爱舞台，自嘲"前任水神"，松弛真诚 |
| `warm-friend` | 温暖朋友 |  | 老朋友式温和 |
| `professional` | 简洁专业 |  | 直球技术答案 + 少寒暄 |
| `witty-cold` | 冷淡毒舌 |  | 高冷工程师风 + 偶尔吐槽 |
| `playful` | 玩伴谐星 |  | 爱开玩笑 + 谐音梗 |
| `custom` | 完全自定义 |  | 全用 `personaCustom` 字段 |

### 宪法式注入 (Furina-only)

`system-prompts.ts:renderPersonaPreamble(profile)`：当 `personaPreset.startsWith('furina-')` 时返回**最高级身份指令**，由 `llm-client.ts` 插在 `SYSTEM_PROMPT` 最顶。明文声明：
- 此身份优先于下方所有默认风格
- 即使 chat history 显示旧 voice，从此条起严格按 Furina 答
- 唯一不可覆盖：安全护栏 / tool schema 正确性 / "不说作为 AI"

### Persona 单一来源

- `src/shared/user-profile-types.ts:PERSONA_PRESET_PROMPTS` — CN persona 文本（**所有 ZH 路径都从这里读**）
- `src/main/llm/system-prompts.ts:PERSONA_PROMPT_EN` — EN persona 文本

老的 `system-prompts.ts` 内 ZH 硬编码副本已收（v0.5.0 重构）。

### 用户档案存储

`~/Library/Application Support/DeskPet-Furina/user-profile.json`：
```json
{
  "name": "用户希望被怎么称呼",
  "about": "背景描述",
  "personaPreset": "furina-companion",
  "personaCustom": "",
  "setupCompleted": true
}
```

⚠️ **遗留**：旧 `~/Library/Application Support/DeskPet/` 死目录（productName 改名前的产物），`migration.ts` 没列入 legacy → 不会自动清。

---

## 7. Skill 框架 (B 架构 PoC)

### 设计

- **dev-curated**：skill 是 owner 在 repo 里维护的 `.md` 文件，**不是用户安装**
- **位置**：`src/main/llm/skills/<name>.md`
- **格式**：frontmatter (`name` / `description` / `trigger?`) + 正文 instructions
- **加载**：`skill-loader.ts` 用 Vite `?raw` 编译时内联（main process bundle 里就有）
- **LLM 体验**：system prompt 列 skill metadata（name + description + trigger），LLM 自己判断要哪个 → 调 `load_skill(name)` tool 取完整指令

### 当前 skill 池

| name | trigger | 用途 |
|---|---|---|
| `pdf-summary` | "总结这个 PDF / 这篇文章在讲什么" | 抓 PDF/URL → 结构化总结 (主旨 + 3-5 要点 + 行动项) |
| `code-review` | "review 一下 / 帮我看下代码" | 5 维度纪律 (正确性/安全/可读性/性能/测试) + 不准 LGTM |
| `daily-brief` | "brief / 今日小结" | 天气 + 当前 app + 今日小结 |

### 加 skill 流程

1. 新文件 `src/main/llm/skills/<new-name>.md`，写 frontmatter + instructions
2. 在 `skill-loader.ts:SKILL_SOURCES` 加一行 `import` + push
3. 重启 dev → system prompt 自动注入；LLM 看到就能调

---

## 8. 主题 (Royal Salon v1)

### 来源

`themes/deskpet-furina/furina-royal-chat-v1.html` — 设计 mockup（独立可打开预览，含 stage / chat 两个 section + state buttons）

### 设计 token (`main.css :root`)

```css
--royal: #1b3aa7;       /* 主色 royal blue */
--royal-deep: #0b1d67;
--royal-dark: #06103a;
--ice: #45aefb;
--ice-soft: #bfe0ff;
--ice-faint: #eaf5ff;   /* 软底背景 */
--gold: #e7bf65;        /* 选中 / accent */
--gold-deep: #aa7e20;
--gold-faint: #fff0bf;
--danger: #bd4756;
--bubble-line: rgba(69, 174, 251, 0.5);
--bubble-fill: rgba(234, 245, 255, 0.58);
```

旧 `--coral / --paper / --warn` 仅 stage / pet 区域用，chat / settings 已全 swap。

### 视觉规则

- Chat panel **全透明 + 无框**：仅 bg 区分气泡
- pet 气泡 → `ice-faint` 背景
- user 气泡 → `gold-faint` 背景
- input → `ice-faint` 软底，focus 变白
- `bubble-field` overlay 12 个 SMIL drift 浮泡装饰
- Settings panel 保留 framed cards (传统设置页结构)，全量 coral→royal 色板 swap

---

## 9. 当前待办

### 🟢 短期（小颗粒、随时做）

- [ ] 真机 smoke 测试 `set_pet_animation('happy'/'thinking')` + LLM 调 `load_skill('pdf-summary')` 端到端
- [ ] docx ↔ .js 命名一致化（`01-桌宠客户端/` 下两对设计稿）
- [ ] migration.ts 加 `'DeskPet'` 到 legacy list（迁 fork 早期遗留死目录）
- [ ] LLM tool prompt 中文文案润色：测下 Furina-companion 调 tool 时语气是否符合人设

### 🟡 中期（需先验证 / 测试）

- [ ] **Skill 真用验证**：跑 pdf-summary / code-review / daily-brief 每个看 LLM 调用是否符合预期
- [ ] 7 条剩 ALIAS_MAP 收（等 cc 主题彻底退役）
- [ ] migration sunset → v1.0.0 时执行 (`storage/migration.ts` + `provider-keys.ts` 注释里已标 sunset target)
- [ ] EN 系统提示真机验证 8 项 scripted scenario（CHANGELOG v0.4.2 注记待办）
- [ ] OpenAI container per-session pinning (ADR-0003 推迟项)

### 🔴 大工程（需先加测试）

- [ ] 上帝文件抽出（CLAUDE.md C2/C4 标）：`index.ts ~2500` / `tools.ts ~2750` / `App.tsx ~1700`
- [ ] 客户端无 test framework → 加 vitest + 关键回归 case
- [ ] macOS Apple Developer signing + notarization + dmg + auto-updater (M6 Phase 2)

### 🔵 远期 / 设计阶段

- [ ] 视觉服务实装（`03-非LLM视觉服务/` 已 DEPRECATED，要做需重启项目）
- [ ] MCP server 接入（README roadmap 提过）
- [ ] 主动 idle 互动（Furina idle 60s 后主动发一句）
- [ ] 跨 turn 长项目记忆（不只是 remember fact，而是组织"项目档案"）
- [ ] Skill 用户安装支持（A 架构 — 仿 Anthropic Beta Skills API）

---

## 10. 发布流程

### 当前阶段 (Phase 1: zip-only)

```bash
cd 01-桌宠客户端/desktop-pet
npm run typecheck                   # 必须双绿
npm run build:mac                   # arm64 + x64 zip
# Output: dist/DeskPet-Furina-<version>-arm64-mac.zip
#         dist/DeskPet-Furina-<version>-mac.zip
```

### 自动发版到 GitHub Release

```bash
env GH_TOKEN=<personal-access-token> \
  npm run build:mac -- --publish always
```

### EN-locale build

```bash
npm run build:mac:en  # DESKPET_LOCALE=en + productName=DeskPet-EN
```

### 版本号 bump (commit 风格)

按 CLAUDE.md S5：单独 commit `chore(release): vX.Y.Z — <reason>`，bump `package.json` + `package-lock.json`。

### Release notes (GitHub)

`gh release create vX.Y.Z dist/*.zip --title "vX.Y.Z" --notes-file RELEASE.md`

### Phase 2 待办 (M6)

- Apple Developer signing
- Notarization
- dmg build (替代 zip)
- auto-updater (electron-updater)

---

## 11. 开发约定（关键 CLAUDE.md 条款）

> 完整宪法在 `CLAUDE.md`。下面只列高频引用的条款编号 + 一句话。

### W1-W8 工作流
- **W1** 一次性完整执行需求（不留补刀）
- **W2** 用户单指令不准要求重复确认
- **W3** 改 main / preload / shared 文件后必须确认 dev 重启标记（`pkill -9 -f 'electron-vite dev'` 强制清场）
- **W4** 用户方向优先于 reviewer 折中
- **W5** 跨进程改动加 debug log 优先于盲读
- **W6** 改动跨 3+ 文件 / 动 IPC / 动 shared 类型 → 召唤审核 + 架构双签
- **W7** 破坏性操作前先 list 目标
- **W8** 完成必须先验收（typecheck + dev 启动 + 复现）

### H1-H5 诚实
- **H1** 完成声明必须带证据（命令 + 输出 / file:line）
- **H2** 禁止幻觉路径 / 行号 / API
- **H3** 禁止美化错误 + 必须主动暴露遗漏
- **H4** 禁止"完美/全面/深度"等吹牛词
- **H5** 不确定就承认 + agent 报告必须自核再转述

### C1-C6 代码架构
- **C1** `shared/` 是单一事实来源
- **C2** 上帝文件零容忍增长（`index.ts` / `tools.ts` / `App.tsx`）
- **C3** 不引入 prefs 当万能后门
- **C4** 上帝文件大改 > 30 行必须先加测试
- **C5** 视觉服务契约改动需双端同步
- **C6** macOS 平台细节注释不允许删

### S1-S5 安全
- **S1** Key 走 Electron safeStorage
- **S2** Electron 安全（`devTools: is.dev` / `nodeIntegration: false` / `contextIsolation: true`）
- **S3** 视觉数据不留存（内存 base64 only，不写盘）
- **S4** 命令执行白名单 + 硬拒清单
- **S5** Git 卫生（.env / *.key 进 .gitignore）

### A1-A6 Agent 角色
- **A1** 代码研究官员（Explore）— 只陈述事实
- **A2** 审核官员 — APPROVE / APPROVE-WITH-CHANGES / REJECT verdict
- **A3** 代码架构师 — 拓扑 / 数据流 / 架构裂缝
- **A4** UI 美术师 — 资产 / 状态机映射 / 主观调性
- **A5** 文档阅读者 — 通读 md / docx
- **A6** 召唤纪律（主进程先做 5-10min 轻量摸底再 dispatch）

---

## 12. 新人上手 Checklist

接手 1 小时内：
1. 读这页 OVERVIEW
2. 读 `CLAUDE.md` 全文（特别 W / H / C / S 条款）
3. 读 `CONTEXT.md`（领域术语）
4. `cd 01-桌宠客户端/desktop-pet && npm install && npm run dev`
5. 桌宠出现在屏幕右下角 → 点开 chat → 发 "你是谁" → 应该是 Furina 友/恋人 voice
6. ⌘+, 开设置看 royal 主题
7. 浏览 `src/main/index.ts` 顶部 50 行 + `app.whenReady` 周边了解启动序

接手 1 天内：
- 读 `docs/adr/` 3 份决策记录（selected-model 单事实源 / 模型热切换 / OpenAI container）
- 翻 `src/main/llm/tools.ts` 看 19 个 tool 的 description + exec 入口
- 在 chat 里试每个 skill（"总结 PDF" / "review 这段代码" / "brief"）

接手 1 周内：
- 跑过完整 build (`npm run build:mac`)
- 加一个新的 skill `.md` 验证 skill 框架
- 改一个 tool description 看 LLM 行为变化

---

## 13. 已知遗留 / 隐患

| 隐患 | 影响 | 处置建议 |
|---|---|---|
| `~/Library/Application Support/DeskPet/` 死目录 | 老用户 fork 早期数据，含 provider keys + chat | migration.ts 加 `'DeskPet'` 到 LEGACY 列表（A3 architect 已出方案） |
| `index.ts` / `tools.ts` / `App.tsx` 上帝文件 | C2 警告，新功能受 50 行上限 | 需先加测试框架 (C4)，再抽 |
| 客户端无 test framework | 大改靠手测 | 加 vitest |
| README `(v0.4.17)` 落后 | 跟 commit 标签未同步 | release 时同步 |
| Tavily key 默认未设 | `web_search` tool 始终禁用 | 用户自行设；Anthropic provider 时 `anthropic_web_search` 替代 |
| Skill 框架未实战 | PoC stage，未测真 LLM 用 | M+1 周内跑全 3 个 skill 验证 |

---

**文档版本**：v1 (与 `fc9816f` commit 同步)
**维护者**：han + Claude Code
**更新规则**：架构 / 待办变化时同步 PR；不变可省。
