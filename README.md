# DeskPet — Pixel Crab AI Companion

> A transparent, always-on-top macOS pixel pet × multi-modal AI assistant — it can see your screen, read/write files, run commands, and search the web.
>
> Electron + React 19 + TypeScript 5.9 + Vercel AI SDK · 6 LLM providers (Anthropic / OpenAI / Google / xAI / DeepSeek / ByteDance).

<p align="center">
  <img src="./docs/assets/demo.gif" alt="DeskPet interactions demo" width="640" />
</p>
<!-- Drop your demo GIF at ./docs/assets/demo.gif and it renders here. -->

It lives in the corner of your desktop. **Click to chat**, and the AI autonomously decides whether to look at your screen, read files, run commands, or hit the web to answer you. Every "doing" capability is gated by a per-action approval modal (for high-risk actions) or hard-denied at compile time (for catastrophic ones), with a complete local audit log.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Sequoia%2B-black.svg)](#-installation-macos)
[![Latest](https://img.shields.io/github/v/release/Ice-teapop/desktop-pet)](https://github.com/Ice-teapop/desktop-pet/releases/latest)

> **🦀 Active theme**: [`themes/deskpet-cc/`](./01-桌宠客户端/desktop-pet/themes/deskpet-cc/) — 21 个原创像素 sprite，
> 致敬 Claude Code 公开 mascot 形象，**MIT 全开放可商用**。
> 沿用了 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 的 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT) 制作规范 + 老 Clawd 设计语言指导。
> 老 `themes/clawd-dev/` 资源保留在 repo 作历史对照，**release 打包产物不含**。
> 见 [§ Acknowledgments](#-acknowledgments) 致谢。

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
│   ├── themes/deskpet-cc/        ← 21 原创像素 sprite (active theme, MIT)
│   ├── themes/clawd-dev/         ← 老 Clawd 资源 (历史对照, release 不打包)
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
     AI sees tool_result and continues (may call more tools, capped at 5 iters)
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
- ✅ M7 theme switching (deskpet-cc 21 原创 sprite 像素螃蟹)
- 📋 More tools: `take_note` / AppleScript automation / MCP server integration

---

## 🤝 Feedback / Contributing

- Bugs / feature requests: [GitHub Issues](https://github.com/Ice-teapop/desktop-pet/issues)
- Privacy concerns or security vulnerabilities: please file a private issue or email [han](https://github.com/Ice-teapop) — do **not** publish PoCs publicly.

---

## 📄 License

**全项目 MIT** —— 源码 + 资源 + 文档全 [MIT](./LICENSE)，可自由商用 / 修改 / 再分发。

### 活跃主题：deskpet-cc

[`themes/deskpet-cc/`](./01-桌宠客户端/desktop-pet/themes/deskpet-cc/) 是当前唯一被 release 打包 + 代码引用的主题。
- 21 个原创像素 sprite，作者 [@Ice-teapop](https://github.com/Ice-teapop) (han)
- 风格致敬 Anthropic Claude Code 公开 mascot 形象（小螃蟹是公开 IP）
- 制作流程沿用 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT) 的 SVG 规范
- 动画 keyframes 节奏借鉴老 Clawd 设计语言（pet-forge 同作者 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 授权指导）

### 历史资源：clawd-dev

[`themes/clawd-dev/`](./01-桌宠客户端/desktop-pet/themes/clawd-dev/) 保留在 repo 作历史对照（v0.4.9 之前的主题），
**不再被代码引用，release artifacts 也不打包它**。该目录下 sprite 属 [@rullerzhou-afk](https://github.com/rullerzhou-afk) 原创作品（[`clawd-on-desk`](https://github.com/rullerzhou-afk/clawd-on-desk) 项目），如需独立分发或商用需联系原作者。

---

## 🙏 Acknowledgments

特别感谢 **[@rullerzhou-afk](https://github.com/rullerzhou-afk)** ——

- 无偿提供了 [pet-forge](https://github.com/rullerzhou-afk/pet-forge) (MIT) 这套 SVG 桌宠制作 skill + 完整工作流
- 在 Claude Code 小螃蟹形象设计 / 像素动画规范 / 状态衔接节奏上给予关键指导
- 全程持续的鼓励与耐心带教
- 在 v0.4.9 主题切换期间帮助梳理 IP 边界 + 形象致敬 vs 复刻原则

本项目 deskpet-cc 主题的 21 个 sprite 全部参考 pet-forge 的 SVG 路线规范创作；睡眠链 / 打字 / 巫师事故 / 抛球 / 招手 / 锤击 等动画 keyframes 节奏直接借鉴老 Clawd 设计语言。

没有她的开源精神和细致带教，DeskPet 桌宠形象不可能在这么短时间内完成从零到 21 个 sprite 的全套替换。**一切归功于她。**

完整鸣谢见 [v0.4.13 release notes](https://github.com/Ice-teapop/desktop-pet/releases/tag/v0.4.13)。

---

- Code + deskpet-cc sprite author: [@Ice-teapop](https://github.com/Ice-teapop) (han)
- pet-forge skill + workflow + 螃蟹形象指导: [@rullerzhou-afk](https://github.com/rullerzhou-afk)
- Built with: Claude Opus 4.7 (1M context)
