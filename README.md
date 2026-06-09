# DeskPet-Furina — 会动、会聊、会干活的芙宁娜桌宠 AI 助手

> 🌊 **《原神》水神芙宁娜形象的桌面 AI 助手**。屏幕角落飘着一个会动的芙宁娜：**点一下就能聊**，AI 自己决定要不要看屏幕、读文件、跑命令、查网。每一项"动手"能力都有逐操作审批弹窗（高危）或编译期硬拒（灾难性），配完整本地审计日志。
>
> 25 个原创 Furina SVG sprite（含 idle 彩蛋 / 戳一下反应 / 拖拽 / 收起挂件全套），由 **A/B/C 三类状态机**驱动；6 家 LLM provider（Anthropic / OpenAI / Google / xAI / DeepSeek / 字节豆包）自动 fallback。
>
> Electron 39 + React 19 + TypeScript 5.9 + Vercel AI SDK。
>
> **v0.5.0** — 一轮系统审查（主审 + 8 个并行 review agent）后的加固版：命令白名单安全绕过、状态机死锁、睡眠逻辑、跨 provider 文案全部修复。详见 [CHANGELOG](./CHANGELOG.md)。

<p align="center">
  <img src="./docs/assets/demo.gif" alt="DeskPet interactions demo" width="640" />
</p>
<!-- Drop your demo GIF at ./docs/assets/demo.gif and it renders here. -->

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Sequoia%2B-black.svg)](#-installation-macos)
[![Latest](https://img.shields.io/github/v/release/Ice-teapop/desktop-pet)](https://github.com/Ice-teapop/desktop-pet/releases/latest)

> **🌊 Active theme**: [`themes/deskpet-furina/`](./01-桌宠客户端/desktop-pet/themes/deskpet-furina/) — 25 个原创 Furina sprite，**MIT 全开放可商用**。
> 备选主题：[`themes/deskpet-cc/`](./01-桌宠客户端/desktop-pet/themes/deskpet-cc/)（CC 螃蟹原创像素，致敬 Anthropic Claude Code 公开 mascot 形象），切换需改 `src/main/storage/theme.ts:THEME_DIR` 并重启。
> 制作工作流沿用 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 的 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT)。
> **Clawd 形象本身未获原作者授权使用** — 本项目仅参考学习了 Clawd 的骨架（动画 rigging / 状态机层次），sprite 100% 独立重画。
> 见 [§ Acknowledgments](#-acknowledgments)。

---

## 🎬 动画与交互特效

桌宠不是一张静态图——它由 **A/B/C 三类状态机**（`src/main/state-machine.ts`，theme.json 驱动）控制，所有动画是自包含 SMIL 的 SVG，按状态无缝切换。

| 特效 | 你会看到什么 | 怎么触发 |
|---|---|---|
| **🌊 待机呼吸** | idle.svg 6s pingpong 循环，角色轻轻起伏 | 默认态 |
| **👀 idle 彩蛋** | 偶尔东张西望 / 打哈欠（idle-look / idle-yawn / idle-living） | 长时间待机随机插播，播完自动回 idle |
| **🖱 光标跟随** | 身体随鼠标方向微微倾斜 + 外置阴影同步偏移（30Hz，dirty-check 省 CPU） | 待机时鼠标在桌面移动 |
| **😴 睡眠链** | idle 3 分钟 → 播一次"趴下"过渡（collapse-sleep）→ 定格进入 sleeping 循环 | **只在真正发呆时**：你在敲代码 / 开着聊天框时不会睡（v0.5.0 修） |
| **🌅 唤醒** | 点一下 / 鼠标移上来 / 切前台 app → 播一次"醒来"过渡 → 回 idle | 任意交互；睡眠链不被戳打断，让唤醒动画完整播完 |
| **👉 戳一下反应** | 双击 → 小跳惊（react-poke）；4 连击 → 东张西望彩蛋 | 连点桌宠本体；v0.5.0 起工作态也有反应 |
| **🤏 拖拽跟手** | 按住即跟手移动 + 屏幕边界 clamp（不会被推出屏外） | 拖动桌宠 |
| **📌 贴边收起 mini** | 拖到屏幕右缘松手 → 收成只露半身的小挂件；hover 时探头看你（peek）；睡着时显示 mini-sleep | 拖近屏幕边；点一下回展开 |
| **🛠 干活时的反馈** | 调用工具时身体周围珊瑚色 busy-ring 闪烁 + 头顶字条 toast；切换前台 app 时表情气泡 | AI 执行 tool / 你切换 app |
| **🔁 切家提示** | 当前 provider 过载/限流时自动切下一家，头顶系统气泡告知（"OpenAI 过载, 已切到 Anthropic"） | provider fallback 自动发生 |
| **💬 流式打字** | 回复像在"打字"一样逐字蹦出，6 家 provider 统一体验 | 任何对话 |

> 状态优先级：`Error > Notification > 过渡桥锁 > Reaction > Working > IdleEgg > Idle`。权威生命周期转换（新对话 / 错误回收 / 重置）用 `force` 旁路，保证桌宠永不卡死在某个表情（v0.5.0 修了 error / thinking 两处死锁）。

---

## ✨ Features

- **🐚 Transparent always-on-top pet** — NSPanel transparent borderless window. Lives across macOS Spaces and floats above fullscreen apps. Frontmost-app detection auto-switches expression (coding / writing / chatting).
- **💬 Streaming chat across 6 providers** — Anthropic Claude / OpenAI GPT / Google Gemini / xAI Grok / DeepSeek / ByteDance 豆包. Switch provider & model from Settings (`⌘+,`); default Anthropic Haiku 4.5. Unified streaming via Vercel AI SDK — the pet "types" replies regardless of provider.
- **👁 Agentic vision** — The AI autonomously calls the `view_screen` tool when it needs to see your current screen. Screenshots go to whichever vision-capable model is currently selected (no OCR middleware).
- **🛠 18 agentic tools** — read/write/list/find/delete files, `run_command` (whitelist silent / risky → modal), `fetch_url`, Tavily web search, clipboard read/write, URL open, system settings panels, user-profile wizard, cross-session `remember`, and more.
- **🧠 Cross-session memory** — Chat history auto-persisted (last 10 exchange pairs) + the AI uses the `remember` tool to write your name / preferences / context into a long-term markdown file. The pet still remembers you on next launch.
- **🎭 User-profile wizard** — On first chat, the AI proactively asks how you'd like to be called, your work background, and a personality preset for the pet (warm friend / concise pro / cold snarky / playmate goofball / custom).
- **⚙️ Settings panel** — `⌘+,` opens a dedicated window. Centralised management of API keys / model / trusted directories / audit log / memory / user profile.
- **🔒 Strong security + privacy discipline:**
  - safeStorage AES-256 encryption for all keys (macOS Keychain-backed)
  - Per-action approval modal + persistent trusted-directory management
  - Command whitelist + shell metachar rejection + path symlink resolution
  - SSRF defense (dns.lookup + comprehensive private-IP coverage + redirect re-verification)
  - Prompt-injection defense (external content wrapped in `<external_content untrusted>` armoring)
  - Local JSONL audit log, auto-rotated at 5 MB; **never uploaded anywhere**

---

## 🚀 Installation (macOS)

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Ice-teapop/desktop-pet/main/scripts/install.sh | bash
```

The script automatically:
- Detects your architecture (Apple Silicon arm64 / Intel x64)
- Pulls the latest zip from GitHub Releases
- Extracts to `/Applications/DeskPet.app`
- Strips the macOS Gatekeeper quarantine attribute — **double-click works next time, no right-click dance**

### Manual install

Grab the zip from [Releases](https://github.com/Ice-teapop/desktop-pet/releases):

- **Apple Silicon (M1/M2/M3/M4)**: `DeskPet-<version>-arm64-mac.zip`
- **Intel Mac**: `DeskPet-<version>-mac.zip`

Unzip → drag `DeskPet.app` to `/Applications` → **first launch: right-click → Open** (because Phase 1 isn't Apple-notarised yet).

### English-locale build

DeskPet ships a separate **English-only build** that installs as a *distinct* `.app` alongside the default (Chinese) version (different appId / userData, you can keep both).

Look for `DeskPet-EN-*` assets in the [Releases](https://github.com/Ice-teapop/desktop-pet/releases) — same install flow as above, just a different package.

To build locally from source:
```bash
cd 01-桌宠客户端/desktop-pet
npm run build:mac:en      # → dist/DeskPet-EN-<version>-...zip
```

Implementation: build-time `DESKPET_LOCALE=en` injection (see `electron.vite.config.ts` + `src/shared/i18n/`). The English build:
- UI strings (Settings, system bubbles, approval modals, error messages) are fully English
- AI default reply language is English, but auto-follows the user's input language (Chinese in → Chinese out)
- Different `appId` (`com.deskpet.en`) and `productName` (`DeskPet-EN`) so it coexists with the Chinese build

> Phase 1 ships zip only — no dmg (`dmg-builder` + macOS Sequoia compatibility bug; Phase 2 will fix it).
> Phase 2 plans Apple Developer signing + notarization, which will also remove the `xattr` step from `install.sh`.

---

## 🔑 Required: at least one LLM provider key

DeskPet supports **6 providers** out of the box (Anthropic / OpenAI / Google / xAI / DeepSeek / ByteDance 豆包). You only need **one** to start. Open Settings (`⌘+,`) → **API Keys** to manage all of them; for legacy Anthropic onboarding you can also paste `sk-ant-...` directly in the pet's chat input.

All keys are encrypted at rest via Electron `safeStorage` (macOS Keychain-backed AES-256). They are stored per-provider in separate files (`<provider>-key.bin`) under `~/Library/Application Support/DeskPet/` and **never uploaded anywhere**.

### Quick-start: pick one provider

| Provider | Sign up | Key format | Default model | Why pick it |
|---|---|---|---|---|
| **Anthropic Claude** | <https://console.anthropic.com> | `sk-ant-api03-...` | Haiku 4.5 | Most polished tool use + vision; $1/$5 per 1M tokens for Haiku |
| **OpenAI** | <https://platform.openai.com/api-keys> | `sk-...` | GPT-4o mini | Reasoning models (o1, o3-mini); native web search + code interpreter |
| **Google Gemini** | <https://aistudio.google.com/apikey> | no fixed prefix | Gemini 2.5 Flash | **Free tier 1500 req/day**; Google Search grounding (most authoritative) |
| **xAI Grok** | <https://console.x.ai> | `xai-...` | Grok 2 | **Exclusive xSearch for real-time X (Twitter) feed data** |
| **DeepSeek** | <https://platform.deepseek.com/api_keys> | `sk-...` | DeepSeek V3 | Best cost/perf ratio; R1 reasoner with visible thinking process |
| **ByteDance 豆包** | <https://console.volcengine.com/ark> | no fixed prefix | Doubao Pro 32k | China-mainland-friendly access; Doubao series + Doubao Vision Pro |

### Switching providers / models

Settings panel (`⌘+,`) → **Pet Behavior**:
- **Provider dropdown** — pick which provider drives the chat
- **Model dropdown** — cascades by selected provider, with capability tags (`(推理)` / `(无 tool)` / `(无 vision)` shown when applicable)

Switching provider auto-clears chat history (tool-call protocol is incompatible across providers). Switching model within the same provider preserves history.

### Provider-specific specialized tools (auto-enabled)

When you select a provider, DeskPet automatically exposes that provider's **native server-side tools** alongside our 18 local agentic tools. The AI picks whichever is most appropriate:

| Provider | Specialized tools auto-enabled |
|---|---|
| **Anthropic** | `anthropic_web_search` (native search, alternative to Tavily) + `anthropic_code_execution` (Python in Anthropic sandbox, safer than local `run_command`) |
| **OpenAI** | `openai_web_search` + `openai_code_interpreter` (Python in OpenAI sandbox) |
| **Google** | `google_search` (Google grounding with citations) + `google_url_context` (parse any URL natively) |
| **xAI** | `xai_live_search` (real-time X feed) + `xai_web_search` |
| **DeepSeek** | R1 model: `<think>` reasoning extraction middleware (prevents tag leak into chat UI) |
| **ByteDance 豆包** | (Standard function calling only — no provider-native server tools yet) |

These run on the provider's infrastructure, not your machine — bypassing local `path-safety` / approval modal / audit log by design (server-sandboxed tools are safer than local execution).

> Billing examples (per 1M tokens): Claude Haiku 4.5 $1/$5 in/out · GPT-4o mini $0.15/$0.60 · Gemini 2.5 Flash free (up to 1500 req/day) · DeepSeek V3 $0.27/$1.10 · etc. A normal one-turn chat costs $0.001-0.005 depending on provider/model.

---

## 🌐 Optional: Tavily web search

Lets the AI call the `web_search` tool. **Free tier = 1000 queries/month**, plenty for daily use.

1. Sign up → https://tavily.com (email only, no credit card)
2. Sign in → Dashboard → top-right **API Key**
3. Copy the `tvly-...` key
4. In DeskPet, click **🔍 Set search key** in the chat panel (or `⌘+,` → Settings → API Keys → Tavily)
5. Paste → save. Once configured, the AI uses `web_search` when relevant.

You don't have to set Tavily — without it the AI just won't call `web_search`, but it can still call `fetch_url` for URLs you give it.

---

## 📷 Optional: macOS screen recording permission

Lets the AI call `view_screen` to see your current screen.

1. In DeskPet, click **🔒 Enable screen vision** → privacy modal → **I understand, enable**
2. macOS pops "DeskPet wants to record screen" → System Settings → Privacy & Security → Screen Recording → tick DeskPet
3. **Fully quit DeskPet and relaunch** (macOS permission propagation requires it)
4. The pet button becomes **👁 Allow AI to view screen**. From there, the AI autonomously decides whether to capture — conservative mode, only when you ask screen-related questions.

> Screenshot bytes stay in memory only and go to the currently selected provider's vision endpoint as base64. The process disables core dumps (`LimitCORE=0`) so a crash can't dump pixel data to disk.

---

## 🏗 Architecture

### Monorepo layout

```
DeskPet智能桌宠助手/
├── 01-桌宠客户端/desktop-pet/   ← main project (Electron app)
│   ├── src/
│   │   ├── main/                 ← Electron main process
│   │   │   ├── index.ts          ← bootstrap / IPC / state machine
│   │   │   ├── llm/
│   │   │   │   ├── llm-client.ts ← Vercel AI SDK streamText + tool loop (replaces old anthropic.ts)
│   │   │   │   ├── providers.ts  ← provider registry: 6 createXxx factories + DeepSeek R1 reasoning middleware
│   │   │   │   ├── tool-defs.ts  ← AI SDK ToolSet wrapper (Zod schemas + toModelOutput)
│   │   │   │   ├── specialized-tools.ts ← per-provider native server-side tool integration
│   │   │   │   ├── tools.ts      ← 18 agentic tool executors + ToolContext
│   │   │   │   ├── path-safety.ts ← path blacklist + symlink resolution
│   │   │   │   ├── command-whitelist.ts ← shell command allowlist
│   │   │   │   └── approval.ts   ← per-action approval IPC
│   │   │   ├── services/         ← screen capture / vision pipeline / frontmost-app monitor
│   │   │   ├── storage/          ← safeStorage-encrypted at rest
│   │   │   └── audit-log.ts      ← local JSONL audit
│   │   ├── preload/              ← contextBridge whitelist API
│   │   ├── renderer/             ← React UI (pet + settings share a bundle, hash routing)
│   │   └── shared/               ← types only
│   ├── themes/deskpet-furina/    ← 25 原创 Furina sprite (active theme, MIT) — THEME_DIR 指向
│   ├── themes/deskpet-cc/        ← CC 螃蟹原创像素 sprite (备选/历史主题, MIT)
│   ├── electron-builder.yml      ← packaging config
│   └── README.md                 ← developer docs
├── 03-非LLM视觉服务/vision-service/  ← legacy OCR service (deprecated after M4-A pivot)
└── scripts/install.sh            ← one-line terminal installer
```

### Tool pool (18, tiered)

```
Read-only / info gathering (no modal)
├── view_screen          capture current screen → selected provider's vision model
├── read_clipboard       read clipboard (with prompt-injection armor)
├── current_app_info     current frontmost app + activity
├── fetch_url            HTTP GET on public URLs (SSRF defense + first-host modal)
└── web_search           Tavily AI-friendly search (requires Tavily key)

Filesystem (default-trust HOME visible top-level dirs; sensitive dirs hard-denied)
├── read_file            read file → wrap in <external_content>
├── list_directory       list a directory
├── find_files           recursive glob search (DoS budget: 50k entries / 5s)
├── write_file           create / overwrite a file
├── create_directory     mkdir -p
└── delete_file          ⚠️ always shows a modal (irreversible)

Terminal
└── run_command          safe whitelist runs silently / others → modal / dangerous → hard-deny
                         (safe path uses spawn shell:false + env allowlist)

Clipboard + browser
├── copy_to_clipboard    write to clipboard
└── open_url             open URL in browser (strict http(s) only)

System settings
├── open_system_settings open a specific macOS settings pane (navigate only)
└── read_system_preference  defaults read (blacklists Keychain / Mail / Safari, etc.)

Memory
├── remember             write to cross-session long-term memory (markdown)
└── save_user_profile    save the user profile (wizard, one-shot)
```

### Data flow: user sends a message

```
User types in the pet chat input → Enter
   ↓
IPC chat:submit → main process
   ↓
Main assembles messages (system prompt + memory + user_profile + chatHistory)
   ↓
client.stream(messages, tools=[18 tools when consent is ON])
   ↓
Selected provider's model (Haiku 4.5 by default) streams a response
   ↓
The AI decides based on the question:
  ├─ No tool needed → stream text directly → pet chat panel
  └─ Tool needed (e.g. view_screen / read_file)
       ↓
     executeTool dispatcher in main
       ├─ Blacklist hit → tool_result error → AI tells the user "can't do that, because..."
       ├─ Default-trusted → silent execute → result wrapped in <external_content>
       └─ Approval required → 4-option modal
                              (deny / once / trust this session / trust forever)
                              → user choice → tool_result
       ↓
     AI sees tool_result and continues (may call more tools, capped at 15 iters)
       ↓
     Final streamed text → pet chat panel
```

---

## 🔐 Privacy + security

### "Never persist" discipline

- **API keys**: safeStorage AES-256 (macOS Keychain-backed), file `chmod 600`, never uploaded
- **Screenshots**: memory-only base64 → HTTPS to selected provider → immediately released. `LimitCORE=0` prevents core dumps containing pixel data.
- **Clipboard**: read only when the AI explicitly calls `read_clipboard`. The main process doesn't log or persist clipboard content.
- **Chat history**: local `chmod 600` JSON; last 10 exchange pairs retained across sessions (user can clear in Settings).
- **Audit log**: local JSONL, auto-rotated at 5 MB. Never uploaded.

### 4-layer defense in depth

1. **Compile-time blacklist** — `.ssh` / `.aws` / `Keychain` / browser data / `.env` are always denied.
2. **Compile-time command hard-deny** — `rm -rf /`, `sudo`, `curl|sh`, `dd`, etc., denied even if the user approves.
3. **Per-action approval modal** (runtime) — 4 options: deny / allow once / trust this dir this session / trust forever.
4. **Audit trail** — every tool call lands in JSONL (never uploaded).

### Prompt-injection defense

- External content returned to the AI (`fetch_url` / clipboard / file content / memory) is always wrapped in `<external_content source="..." untrusted>...</external_content>` armoring.
- The system prompt explicitly teaches the AI to treat untrusted content as data, not as instructions.
- A literal `</external_content>` inside the inner content is escaped to block tag-closing injection.

### SSRF defense

- `fetch_url` resolves the hostname via `dns.lookup`. Every returned IP must be public.
- Private-IP form coverage: 0/8, 127/8, 10/8, 172.16–31, 192.168, 169.254, 100.64–127 CGNAT, 224+ multicast, IPv4-mapped IPv6 (including hex), `fc/fd` unique-local, `fe80–feb` link-local.
- `redirect: 'manual'` re-verifies hostname → IP on every hop, blocking 302-to-metadata-IP attacks.
- `.local` / `.internal` / `.lan` / `.home` / `.corp` / `.intranet` TLDs are refused.

---

## 💻 Development

### Dev mode

```bash
git clone https://github.com/Ice-teapop/desktop-pet.git
cd desktop-pet/01-桌宠客户端/desktop-pet
npm install
npm run dev
```

The pet appears in the bottom-right corner with hot reload.

### Packaging a release

```bash
cd 01-桌宠客户端/desktop-pet
npm run build:mac
# Output in dist/
#   DeskPet-<version>-arm64-mac.zip   (Apple Silicon)
#   DeskPet-<version>-mac.zip         (Intel)
```

Upload the zip to GitHub Releases. Or automate it (`GH_TOKEN` required):

```bash
env GH_TOKEN=<your-github-personal-access-token> npm run build:mac -- --publish always
```

### File map (`desktop-pet/`)

| Path | Purpose |
|------|---------|
| `src/main/index.ts` | Electron main entry + IPC handlers + state machine |
| `src/main/llm/llm-client.ts` | Vercel AI SDK streamText + tool loop (max 5 steps) + system prompt |
| `src/main/llm/providers.ts` | 6 provider factory registry (Anthropic/OpenAI/Google/xAI/DeepSeek/ByteDance) + DeepSeek R1 reasoning middleware |
| `src/main/llm/tool-defs.ts` | AI SDK ToolSet wrapper (Zod schemas + toModelOutput image handling) |
| `src/main/llm/specialized-tools.ts` | Per-provider native server-side tool integration (web search / code execution / etc) |
| `src/main/llm/tools.ts` | 18 tool executors + ToolContext |
| `src/main/services/active-app.ts` | Swift binary that detects the frontmost app |
| `src/main/storage/*.ts` | safeStorage encryption / preferences JSON |
| `src/renderer/src/App.tsx` | Pet + chat React component |
| `src/renderer/src/Settings.tsx` | Settings panel (standalone BrowserWindow) |
| `electron-builder.yml` | Packaging config (zip target, entitlements, publish) |

Full developer docs: [01-桌宠客户端/desktop-pet/README.md](01-桌宠客户端/desktop-pet/README.md)

---

## 📜 Roadmap

- ✅ M0–M3 pet UI / state machine / activity recognition
- ✅ M4-A vision agentic (multi-provider vision + tool use)
- ✅ M4-B local tools (clipboard / URL / app info)
- ✅ M4-C filesystem / terminal / system-settings tools + approval flow + audit log
- ✅ M4-D network tools (`fetch_url` + Tavily search)
- ✅ M5 Settings panel + cross-session memory + user-profile wizard
- ✅ M6 Phase 1 zip + GitHub Releases + one-line install script
- ✅ M7 multi-provider refactor: 6 LLM providers via Vercel AI SDK + provider-specific specialized tools (web search / code execution / X live search / R1 reasoning)
- 🚧 M6 Phase 2 Apple Developer notarization + dmg + auto-updater
- ✅ M7 theme switching (deskpet-cc 原创像素螃蟹 + deskpet-furina 原创 Furina sprite，THEME_DIR 已切 furina)
- 📋 More tools: `take_note` / AppleScript automation / MCP server integration

---

## 🤝 Feedback / Contributing

- Bugs / feature requests: [GitHub Issues](https://github.com/Ice-teapop/desktop-pet/issues)
- Privacy concerns or security vulnerabilities: please file a private issue or email [han](https://github.com/Ice-teapop) — do **not** publish PoCs publicly.

---

## 📄 License

**全项目 MIT** —— 源码 + 资源 + 文档全 [MIT](./LICENSE)，可自由商用 / 修改 / 再分发。

### 活跃主题：deskpet-furina（备选 deskpet-cc）

`themes/deskpet-furina/` 是 `THEME_DIR` 当前指向（`src/main/storage/theme.ts`），打 release 时随包。
- 25 个原创 Furina 状态 sprite（含 idle 彩蛋 / react-poke / react-drag / mini-* 全套），作者 [@Ice-teapop](https://github.com/Ice-teapop) (han)
- A/B/C 三类状态机驱动（见 `01-桌宠客户端/desktop-pet/src/main/state-machine.ts`）

`themes/deskpet-cc/` 仍在仓内作为备选 / 历史主题（CC 螃蟹原创像素 sprite）。切换需改 `THEME_DIR` 并重启 app。
- 风格致敬 Anthropic Claude Code 公开 mascot 形象（小螃蟹是 Anthropic 公开 IP）
- 制作流程沿用 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT)
- 骨架结构（动画 rigging / 状态机层次思路）参考学习了 Clawd 项目 — **Clawd 形象本身未授权**，本项目只借鉴骨架不复刻

> ⚠️ 老 `themes/clawd-dev/` 文件夹已于 v0.4.17 从 repo 删除。该文件夹曾作骨架学习的历史对照保留，但 Clawd 形象本身从未获原作者授权使用，故彻底移除。Clawd 是 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 的 IP，想看 / 想用请去她的 [`clawd-on-desk`](https://github.com/rullerzhou-afk/clawd-on-desk) 项目。

---

## 🙏 Acknowledgments

感谢 **[@rullerzhou-afk](https://github.com/rullerzhou-afk)** ——

- 开源了 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT) 这套 SVG 桌宠制作工作流，本项目用它从零搭建 deskpet-cc 的全部 21 个 sprite
- 她的 [Clawd 项目](https://github.com/rullerzhou-afk/clawd-on-desk) 为本项目提供了**骨架层面的学习参考**（动画 rigging 思路 / 状态机层次结构）

### ⚠️ 事实边界声明

- **Clawd 形象本身未获原作者授权使用** — 本项目早期临时借用过 Clawd 资产，被原作者发现后她给了一个缓冲期让我重做，于是有了完全原创的 deskpet-cc 主题（v0.4.9 起）
- deskpet-cc 21 个 sprite **完全独立重画**，致敬 Anthropic Claude Code 公开 mascot 形象（小螃蟹是 Anthropic 公开 IP），**不含任何 Clawd 资产**
- v0.4.17 起 `themes/clawd-dev/` 文件夹也已从 repo 完全删除（曾作骨架学习历史对照保留）
- Clawd 是 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 的 IP，想看 / 想用请去她的 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 项目并联系她

---

- Code + deskpet-cc sprite author: [@Ice-teapop](https://github.com/Ice-teapop) (han)
- pet-forge (MIT 工作流) 作者: [@rullerzhou-afk](https://github.com/rullerzhou-afk)
- Built with: Claude Opus 4.7 (1M context)
