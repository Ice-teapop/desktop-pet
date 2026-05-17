# DeskPet 智能桌宠助手

> 透明置顶的 macOS 桌面像素螃蟹 × 多模态 AI 助手，可看屏幕 / 读写文件 / 跑命令 / 联网搜索。
>
> Electron + React 19 + TypeScript 5.9 + Anthropic Claude SDK.

```
                 .--.
                / o o\
               | =__= |
                \    /
              ---'  '---
```

跑在你桌面的角落，**点击对话开始聊**，AI 自主决定要不要看屏、读文件、跑命令、查网络来回答你。所有"做事"的能力都用一道审批 modal 守门（高风险动作）或硬黑名单挡死（致命动作），有完整本地审计日志。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![macOS](https://img.shields.io/badge/macOS-Sequoia%2B-black.svg)](#installation)

---

## ✨ 主要特性

- **🐚 透明置顶桌宠**：NSPanel 透明无边框窗口，跨 macOS Spaces + 浮在全屏 app 上方。前台 app 自动识别（写代码 / 写文档 / 聊天）切换形象
- **💬 流式对话**：Anthropic Claude Haiku 4.5 默认，可切 Sonnet 4.6 / Opus 4.7。SDK 实时 streaming，桌宠会"打字"
- **👁 视觉感知（agentic）**：AI 通过 `view_screen` tool 自主决定是否截当前屏幕。截图直接发 Claude vision 不走 OCR
- **🛠 18 个 agentic tools**：read/write/list/find/delete 文件、run_command（白名单免审批 / 高风险弹 modal）、fetch_url、Tavily 联网搜索、剪贴板读写、URL 打开、系统设置面板、用户档案 wizard、跨会话 remember 等
- **🧠 跨会话记忆**：对话历史自动持久化（10 对话 pair）+ AI 通过 `remember` tool 把用户称呼/偏好写入 markdown 长期记忆；下次启动桌宠仍记得
- **🎭 用户档案 wizard**：首次对话 AI 主动问你想被怎么称呼 + 工作背景 + 桌宠风格预设（温暖朋友 / 简洁专业 / 冷淡毒舌 / 玩伴谐星 / 自定义）
- **⚙️ 设置面板**：⌘+, 打开独立窗口，集中管理 API keys / 模型 / 信任目录 / 审计日志 / 记忆 / 用户档案
- **🔒 强安全 + 隐私纪律**：
  - safeStorage AES-256 加密所有 keys（macOS Keychain backed）
  - per-action approval modal + 持久信任目录管理
  - 命令白名单 + shell metachar 拦截 + path symlink 解析
  - SSRF 防御（dns.lookup + 私网 IP 全形式校验 + redirect 重校验）
  - prompt injection 防御（external content 包 `<external_content untrusted>` 标签）
  - 本地 JSONL 审计日志，5MB 自动滚动；**不上传任何位置**

---

## 🚀 安装（macOS）

### 一行命令装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/Ice-teapop/desktop-pet/main/scripts/install.sh | bash
```

脚本自动：
- 检测架构（Apple Silicon arm64 或 Intel x64）
- 从 GitHub Releases 拉最新版 zip
- 解压到 `/Applications/DeskPet.app`
- 脱 macOS Gatekeeper quarantine —— **下次双击直接打开，不报警**

### 手动安装

到 [Releases](https://github.com/Ice-teapop/desktop-pet/releases) 自己下 zip：

- **Apple Silicon (M1/M2/M3/M4)**: `DeskPet-<version>-arm64-mac.zip`
- **Intel Mac**: `DeskPet-<version>-mac.zip`

解压 → 拖 `DeskPet.app` 到 `/Applications` → **首次右键 → 打开**（因为 Phase 1 没做 Apple 公证）。

> Phase 1 暂时只出 zip 不出 dmg（dmg-builder + macOS Sequoia 兼容 bug，Phase 2 修）
> Phase 2 计划补 Apple Developer 公证签名，到时 `curl|bash` 脚本里的 `xattr` 步也不需要

---

## 🔑 必需配置：Anthropic API key

桌宠对话引擎用。**没这个 key 就无法对话**。

1. 注册 → https://console.anthropic.com
2. Sign in → **Settings** → **API Keys** → **Create Key**
3. 复制 `sk-ant-api03-...` 格式的 key
4. 启动 DeskPet → 对话框占位符提示"粘 API key 到这里" → 粘贴回车
5. key 自动 safeStorage 加密落盘（macOS Keychain backed AES-256），不上传任何位置

> 计费：Haiku 4.5 是 $1/1M input + $5/1M output tokens。日常对话单次 turn ~$0.001。如果开了 vision 看屏，单次截图 ~$0.002。

---

## 🌐 可选配置：Tavily 联网搜索

让 AI 能调 `web_search` tool 查互联网。**免费 tier 1000 queries/月**够日常用。

1. 注册 → https://tavily.com（邮箱注册，免信用卡）
2. Sign in → Dashboard 右上角找 **API Key**
3. 复制 `tvly-...` 格式的 key
4. DeskPet 桌宠对话框点 **🔍 设搜索 key** 按钮（或 ⌘+, 设置面板 → API Keys → Tavily）
5. 粘贴 → 保存。配好后 AI 看到 `web_search` tool 自动用

不配 Tavily 也行 —— AI 不会调 `web_search`，但能用 `fetch_url` tool 抓你提供的 URL。

---

## 📷 可选配置：macOS 屏幕录制权限

让 AI 能通过 `view_screen` tool 看你当前屏幕。

1. DeskPet 桌宠对话框点 **🔒 启用屏幕感知** → 弹隐私 modal → **我已了解，启用**
2. 系统弹"DeskPet 想录制屏幕" → 系统设置 → 隐私与安全性 → 屏幕录制 → 勾上 DeskPet
3. **完全 quit DeskPet 重启**（macOS 权限传播要求）
4. 桌宠按钮变 **👁 允许 AI 看屏** → 发消息时 AI 自主决定是否截屏（保守模式 —— 只在你问屏幕相关的事时调）

> 截图字节全程仅内存 + base64 发 Anthropic Claude vision；桌宠加 LimitCORE=0 不允许进程崩溃 dump 内存到盘

---

## 🏗 架构

### Monorepo 结构

```
DeskPet智能桌宠助手/
├── 01-桌宠客户端/desktop-pet/   ← 主项目（Electron app）
│   ├── src/
│   │   ├── main/                 ← Electron main 进程
│   │   │   ├── index.ts          ← 启动 / IPC / 状态机
│   │   │   ├── llm/
│   │   │   │   ├── anthropic.ts  ← Claude SDK 封装 + tool loop
│   │   │   │   ├── tools.ts      ← 18 个 agentic tool 定义 + executor
│   │   │   │   ├── path-safety.ts ← 文件路径黑名单 + symlink 解析
│   │   │   │   ├── command-whitelist.ts ← shell 命令白名单
│   │   │   │   └── approval.ts   ← per-action 审批 IPC
│   │   │   ├── services/         ← 截屏 / vision pipeline / 前台 app 监控
│   │   │   ├── storage/          ← safeStorage 加密落盘
│   │   │   └── audit-log.ts      ← 本地 JSONL 审计
│   │   ├── preload/              ← contextBridge 白名单 API
│   │   ├── renderer/             ← React UI（pet + settings 共享 bundle hash 路由）
│   │   └── shared/               ← types only
│   ├── themes/clawd-dev/         ← AGPL 隔离的 clawd 像素美术资源（gitignored）
│   ├── electron-builder.yml      ← 打包配置
│   └── README.md                 ← 开发者文档
├── 03-非LLM视觉服务/vision-service/  ← 早期 OCR 服务（M4-A pivot 后停用）
└── scripts/install.sh            ← 一键终端安装
```

### Tool 池（18 个，分层）

```
信息采集（不弹 modal）
├── view_screen          截当前屏幕 → Claude vision
├── read_clipboard       读剪贴板（含 prompt injection 防御）
├── current_app_info     当前前台 app + 活动状态
├── fetch_url            HTTP GET 公网 URL（SSRF 防御 + 首次每 host 弹 modal）
└── web_search           Tavily AI 友好搜索（需 Tavily key）

文件系统（默认信任 HOME 顶级 visible 目录，敏感目录硬拒）
├── read_file            读文件 → 包 <external_content> 标签
├── list_directory       列目录
├── find_files           递归 glob 搜索（DoS 预算 50k entries / 5s）
├── write_file           创建 / 覆盖文件
├── create_directory     mkdir -p
└── delete_file          ⚠️ 始终弹 modal（不可逆）

终端
└── run_command          safe whitelist 静默 / 其它弹 modal / 危险硬拒
                         （safe 路径走 spawn shell:false + env 白名单）

剪贴板 + 浏览器
├── copy_to_clipboard    写剪贴板
└── open_url             浏览器打开 URL（严格 http(s)）

系统设置
├── open_system_settings 打开特定 macOS 设置面板（仅 navigate）
└── read_system_preference  defaults read（黑名单 keychain / mail / safari 等）

记忆
├── remember             写入跨会话长期记忆（markdown）
└── save_user_profile    保存用户档案（wizard 一次性）
```

### 数据流：用户发消息

```
用户在桌宠对话区打字 → Enter
   ↓
IPC chat:submit → main 进程
   ↓
main 拼 messages（含 system prompt + memory + user_profile + chatHistory）
   ↓
client.stream(messages, tools=[18 tools when consent ON])
   ↓
Anthropic Claude（默认 Haiku 4.5）流式响应
   ↓
AI 看用户问题决定:
  ├─ 不需要 tool → 直接流式回文本 → 桌宠对话区显示
  └─ 需要 tool（e.g. view_screen / read_file）
       ↓
     main 端 executeTool dispatcher
       ├─ 黑名单命中 → tool_result error → AI 告诉用户"做不到，原因是..."
       ├─ 默认信任 → 静默执行 → 结果包 <external_content>
       └─ 需 approval → 弹 modal 4 选项（拒/一次/信任本会话/永久信任）
                       → 用户点击 → tool_result
       ↓
     AI 看到 tool_result 续答（可能再调 tool，最多 5 iter 防死循环）
       ↓
     最终流式文本 → 桌宠对话区
```

---

## 🔐 隐私 + 安全

### "不留存" 纪律

- **API keys**：safeStorage AES-256 加密（macOS Keychain backed），文件 chmod 600，绝不上传
- **截图**：仅内存 base64 → HTTPS 发 Anthropic → 本地立刻释放。LimitCORE=0 防进程崩溃 core dump
- **剪贴板**：仅 AI 显式调 `read_clipboard` 时读，main 进程不日志、不持久化
- **对话历史**：本地 chmod 600 JSON，跨会话保留 10 对话 pair（用户可在设置清空）
- **审计日志**：本地 JSONL，5MB 自动滚动，不上传

### 4 道防御纵深

1. **静态黑名单**（编译时）—— `.ssh`/`.aws`/`Keychain`/浏览器数据/`.env` 等永远拒
2. **命令硬拒**（编译时）—— `rm -rf /`、`sudo`、`curl|sh`、`dd` 等即使审批也拒
3. **per-action approval modal**（运行时）—— 4 选项：拒绝 / 允许一次 / 信任此目录本会话 / 永久信任
4. **审计追溯** —— 每次 tool 调用 JSONL 记录（不上传）

### 对 prompt injection 的防御

- AI tool 返回的外部内容（fetch_url / clipboard / file content / memory）全部包 `<external_content source="..." untrusted>...</external_content>` 标签
- system prompt 显式教 AI 把 untrusted 当 data 不当指令
- inner content 里 `</external_content>` 字面被 escape 防闭合标签注入

### 对 SSRF 的防御

- `fetch_url` 用 `dns.lookup` 解析 hostname，所有返回 IP 必须公网
- 私网 IP 全形式覆盖：0/8、127/8、10/8、172.16-31、192.168、169.254、100.64-127 CGNAT、224+ 多播、IPv4-mapped IPv6（含 hex 形式）、fc/fd unique-local、fe80-feb link-local
- `redirect: 'manual'` 每跳重做 hostname → IP 校验，防 302 到 metadata IP
- `.local` / `.internal` / `.lan` / `.home` / `.corp` / `.intranet` TLD 拒解析

---

## 💻 开发

### 跑 dev 模式

```bash
git clone https://github.com/Ice-teapop/desktop-pet.git
cd desktop-pet/01-桌宠客户端/desktop-pet
npm install
npm run dev
```

桌宠出现在右下角，hot reload。

### 打包发布

```bash
cd 01-桌宠客户端/desktop-pet
npm run build:mac
# 产物在 dist/
#   DeskPet-<version>-arm64-mac.zip   （Apple Silicon）
#   DeskPet-<version>-mac.zip         （Intel）
```

把 zip 上传到 GitHub Releases。或自动化（需 `GH_TOKEN`）：

```bash
env GH_TOKEN=<your-github-personal-access-token> npm run build:mac -- --publish always
```

### 文件结构（desktop-pet/）

| 路径 | 用途 |
|------|------|
| `src/main/index.ts` | Electron 主进程入口 + IPC handlers + 状态机 |
| `src/main/llm/anthropic.ts` | Claude SDK + tool loop（最多 5 iter）+ system prompt |
| `src/main/llm/tools.ts` | 18 个 tool 定义 + executor dispatcher |
| `src/main/services/active-app.ts` | Swift binary 检测前台 app |
| `src/main/storage/*.ts` | safeStorage 加密 / preferences JSON |
| `src/renderer/src/App.tsx` | 桌宠 + 对话区 React 组件 |
| `src/renderer/src/Settings.tsx` | 设置面板（独立 BrowserWindow） |
| `electron-builder.yml` | 打包配置（zip target、entitlements、publish）|

详细开发文档：[01-桌宠客户端/desktop-pet/README.md](01-桌宠客户端/desktop-pet/README.md)

---

## 📜 Roadmap

- ✅ M0~M3 桌宠 UI / 状态机 / 活动识别
- ✅ M4-A vision agentic（Claude vision + tool use）
- ✅ M4-B local tools（剪贴板 / URL / app info）
- ✅ M4-C 文件系统 / 终端 / 系统设置 tools + 审批流程 + 审计日志
- ✅ M4-D 网络 tools（fetch_url + Tavily 搜索）
- ✅ M5 设置面板 + 跨会话记忆 + 用户档案 wizard
- ✅ M6 Phase 1 zip + GitHub Releases + 一键 install 脚本
- 🚧 M6 Phase 2 Apple Developer 公证签名 + dmg + auto-updater
- 📋 M7 主题切换（多 clawd 替代美术）
- 📋 更多 tools：take_note / AppleScript 自动化 / MCP server 集成

---

## 🤝 反馈 / 贡献

- 报 bug / 提需求：[GitHub Issues](https://github.com/Ice-teapop/desktop-pet/issues)
- 隐私问题或安全漏洞：先发 issue 或邮件给 [han](https://github.com/Ice-teapop)，不要公开 PoC

---

## 📄 License

[MIT](./LICENSE)。clawd 像素美术资源在 `themes/clawd-dev/` 目录下走独立 AGPL，**不入库**，需要本地手动拉取（详见 [`themes/clawd-dev/README.md`](./01-桌宠客户端/desktop-pet/themes/clawd-dev/README.md)）。

代码作者：[@Ice-teapop](https://github.com/Ice-teapop)
桌宠形象：clawd by [@rullerzhou](https://github.com/rullerzhou)
开发协作：Claude Opus 4.7 (1M context)
