# DeskPet — Pixel Crab AI Companion

> A transparent, always-on-top macOS pixel pet × multi-modal AI assistant — it can see your screen, read/write files, run commands, and search the web.
>
> Electron + React 19 + TypeScript 5.9 + Anthropic Claude SDK.

<p align="center">
  <img src="./docs/assets/demo.gif" alt="DeskPet interactions demo" width="640" />
</p>
<!-- Drop your demo GIF at ./docs/assets/demo.gif and it renders here. -->

It lives in the corner of your desktop. **Click to chat**, and the AI autonomously decides whether to look at your screen, read files, run commands, or hit the web to answer you. Every "doing" capability is gated by a per-action approval modal (for high-risk actions) or hard-denied at compile time (for catastrophic ones), with a complete local audit log.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Sequoia%2B-black.svg)](#-installation-macos)

---

## ✨ Features

- **🐚 Transparent always-on-top pet** — NSPanel transparent borderless window. Lives across macOS Spaces and floats above fullscreen apps. Frontmost-app detection auto-switches expression (coding / writing / chatting).
- **💬 Streaming chat** — Anthropic Claude Haiku 4.5 by default; switchable to Sonnet 4.6 / Opus 4.7. Real-time SDK streaming — the pet "types" replies.
- **👁 Agentic vision** — The AI autonomously calls the `view_screen` tool when it needs to see your current screen. Screenshots go straight to Claude vision (no OCR middleware).
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

> Phase 1 ships zip only — no dmg (`dmg-builder` + macOS Sequoia compatibility bug; Phase 2 will fix it).
> Phase 2 plans Apple Developer signing + notarization, which will also remove the `xattr` step from `install.sh`.

---

## 🔑 Required: Anthropic API key

Powers the chat engine. **Without this key the pet cannot talk.**

1. Sign up → https://console.anthropic.com
2. Sign in → **Settings** → **API Keys** → **Create Key**
3. Copy the `sk-ant-api03-...` key
4. Launch DeskPet → paste the key into the chat input's placeholder prompt → hit return
5. The key is encrypted at rest via `safeStorage` (macOS Keychain-backed AES-256). Never uploaded.

> Billing: Haiku 4.5 is $1 / 1M input + $5 / 1M output tokens. A normal one-turn chat costs ~$0.001. With vision on, a screenshot turn costs ~$0.002.

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

> Screenshot bytes stay in memory only and go to Anthropic Claude vision as base64. The process disables core dumps (`LimitCORE=0`) so a crash can't dump pixel data to disk.

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
│   │   │   │   ├── anthropic.ts  ← Claude SDK wrapper + tool loop
│   │   │   │   ├── tools.ts      ← 18 agentic tool defs + executor
│   │   │   │   ├── path-safety.ts ← path blacklist + symlink resolution
│   │   │   │   ├── command-whitelist.ts ← shell command allowlist
│   │   │   │   └── approval.ts   ← per-action approval IPC
│   │   │   ├── services/         ← screen capture / vision pipeline / frontmost-app monitor
│   │   │   ├── storage/          ← safeStorage-encrypted at rest
│   │   │   └── audit-log.ts      ← local JSONL audit
│   │   ├── preload/              ← contextBridge whitelist API
│   │   ├── renderer/             ← React UI (pet + settings share a bundle, hash routing)
│   │   └── shared/               ← types only
│   ├── themes/clawd-dev/         ← AGPL-isolated clawd pixel assets (gitignored)
│   ├── electron-builder.yml      ← packaging config
│   └── README.md                 ← developer docs
├── 03-非LLM视觉服务/vision-service/  ← legacy OCR service (deprecated after M4-A pivot)
└── scripts/install.sh            ← one-line terminal installer
```

### Tool pool (18, tiered)

```
Read-only / info gathering (no modal)
├── view_screen          capture current screen → Claude vision
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
Anthropic Claude (Haiku 4.5 by default) streams a response
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
- **Screenshots**: memory-only base64 → HTTPS to Anthropic → immediately released. `LimitCORE=0` prevents core dumps containing pixel data.
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
| `src/main/llm/anthropic.ts` | Claude SDK + tool loop (max 5 iters) + system prompt |
| `src/main/llm/tools.ts` | 18 tool definitions + executor dispatcher |
| `src/main/services/active-app.ts` | Swift binary that detects the frontmost app |
| `src/main/storage/*.ts` | safeStorage encryption / preferences JSON |
| `src/renderer/src/App.tsx` | Pet + chat React component |
| `src/renderer/src/Settings.tsx` | Settings panel (standalone BrowserWindow) |
| `electron-builder.yml` | Packaging config (zip target, entitlements, publish) |

Full developer docs: [01-桌宠客户端/desktop-pet/README.md](01-桌宠客户端/desktop-pet/README.md)

---

## 📜 Roadmap

- ✅ M0–M3 pet UI / state machine / activity recognition
- ✅ M4-A vision agentic (Claude vision + tool use)
- ✅ M4-B local tools (clipboard / URL / app info)
- ✅ M4-C filesystem / terminal / system-settings tools + approval flow + audit log
- ✅ M4-D network tools (`fetch_url` + Tavily search)
- ✅ M5 Settings panel + cross-session memory + user-profile wizard
- ✅ M6 Phase 1 zip + GitHub Releases + one-line install script
- 🚧 M6 Phase 2 Apple Developer notarization + dmg + auto-updater
- 📋 M7 theme switching (multiple clawd-alternative art packs)
- 📋 More tools: `take_note` / AppleScript automation / MCP server integration

---

## 🤝 Feedback / Contributing

- Bugs / feature requests: [GitHub Issues](https://github.com/Ice-teapop/desktop-pet/issues)
- Privacy concerns or security vulnerabilities: please file a private issue or email [han](https://github.com/Ice-teapop) — do **not** publish PoCs publicly.

---

## 📄 License

[MIT](./LICENSE). The clawd pixel-art assets in `themes/clawd-dev/` are independently AGPL-licensed and **never enter this repo** — they must be fetched locally (see [`themes/clawd-dev/README.md`](./01-桌宠客户端/desktop-pet/themes/clawd-dev/README.md)).

Code author: [@Ice-teapop](https://github.com/Ice-teapop)
Pet art (clawd): by [@rullerzhou](https://github.com/rullerzhou)
Built with: Claude Opus 4.7 (1M context)
