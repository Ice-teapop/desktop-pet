# desktop-pet

DeskPet 智能桌宠助手 —— Electron + React + TypeScript 透明置顶桌宠 + 多模态 AI 助手。

## Quick start

```bash
npm install
npm run dev
```

首次启动会引导你配置 Anthropic API key（必需，对话引擎）；其它 API key + 系统权限按需配（见下方「外部依赖」）。

## Project Setup

### Recommended IDE
[VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

### Scripts

```bash
npm run dev          # 开发模式，main 进程 hot reload
npm run typecheck    # 双 config tsc 校验
npm run build        # production build
npm run build:mac    # 打包 macOS dmg
npm run build:win    # 打包 Windows
npm run build:linux  # 打包 Linux
```

## 外部依赖（API keys + 系统权限）

DeskPet 的核心对话引擎依赖 Anthropic API；agentic tools（屏幕感知 / 网页搜索）需要额外的 key + macOS 权限。**所有 key 都通过 Electron safeStorage AES-256 加密落盘**（macOS Keychain backed），不上传任何第三方。

### 1. Anthropic API key（**必需**）

对话引擎用。首次启动桌宠对话框会出现"粘 API key 到这里"占位符。

1. 注册：<https://console.anthropic.com>
2. Settings → API Keys → Create Key
3. 复制 `sk-ant-api03-...` 格式的 key
4. 在桌宠输入框粘贴即可，自动加密本地存储
5. dev 后门：`ANTHROPIC_API_KEY=sk-ant-... npm run dev` 优先于落盘 key

### 2. Tavily Search API key（可选 —— 用 AI 联网搜索时）

启用后 AI 可以自主调用 `web_search` tool 查互联网。免费 tier **1000 queries/月**够日常用。

1. 注册：<https://tavily.com> （邮箱注册即可，无需信用卡）
2. 登录后 Dashboard → 复制 `tvly-...` 格式的 API key
3. 在桌宠对话区点 **「🔍 设搜索 key」** 按钮
4. modal 内粘贴 key → 点「保存」→ 按钮变 **「🔍 搜索就绪」**
5. dev 后门：`TAVILY_API_KEY=tvly-... npm run dev` 优先于落盘 key

不配 key 也能用 `fetch_url` tool 让 AI 直接抓你给的 URL，只是 AI 不能自己"找" URL 而已。

### 3. macOS 屏幕录制权限（可选 —— 用 AI 看屏功能时）

启用 `view_screen` tool（让 AI 看你当前屏幕）必需。

1. 桌宠对话区点 **「🔒 启用屏幕感知」** → 弹隐私 modal → 「我已了解，启用」
2. 系统会弹「DeskPet 想录制屏幕」权限请求
   - 若没弹：手动开 **系统设置 → 隐私与安全性 → 屏幕录制** →「+」→ 选择 `Electron.app`（dev 模式下在 `node_modules/electron/dist/Electron.app`）
3. **完全退出 DeskPet 重启**（macOS 权限传播要求）
4. 重启后按钮变 **「👁 允许 AI 看屏」**，发消息时 AI 自主决定是否截屏

### 4. 文件系统访问

无需额外配置。AI 可调 `read_file` / `write_file` / `find_files` 等 tool 操作你的文件。

**默认信任范围**：`~/Documents`、`~/Downloads`、`~/Desktop`、`~/Projects`、`~/notes` 等 HOME 下 visible 顶级目录 —— AI 在这些范围内读写无需确认。

**永远拒绝**：`~/.ssh`、`~/.aws`、`Keychain`、浏览器数据目录、`.env` 文件等。

**首次访问其它目录**（如 `~/.config/git/config`）会弹审批 modal，4 选项：
- 拒绝
- 允许一次
- 信任此目录（本会话）
- 永久信任此目录

`delete_file` 永远弹 modal（不可逆操作）。

### 5. 终端命令执行

无需配置。AI 可调 `run_command` tool。

- **白名单命令**（`ls` / `cat` / `pwd` / `git status,log,diff,branch` / `ps` / `df` / `which` / `brew list` / `npm list` / `pip list` 等只读命令）静默执行
- **其它命令**弹审批 modal
- **永远拒绝**：`sudo` / `rm -rf /` 或 `~` / `curl|sh` / `dd` / `mkfs` / `chmod +s` 等

## 数据隐私

- **API keys**：safeStorage 加密落盘，绝不上传
- **截屏**：仅在内存 base64 → 发 Anthropic Claude → 本地立即释放，不写盘（macOS 进程 core dump 也禁用了）
- **剪贴板**：仅在 AI 显式调 `read_clipboard` 时读，且 system prompt 教 AI 看到密码/secret 时不复述
- **文件操作**：审计日志写本地 `~/Library/Application Support/DeskPet/audit.log`（JSONL，5MB 自动滚动），不上传

## 安装（end user）

### 一行命令安装（macOS，推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/Ice-teapop/desktop-pet/main/scripts/install.sh | bash
```

> `install.sh` 在 monorepo 根目录的 `scripts/` 下（不是 `01-桌宠客户端/desktop-pet/scripts/`）。

脚本自动：
- 检测你的架构（M1/M2/M3/M4 arm64 或 Intel x64）
- 从 GitHub Releases 拉最新版 zip
- 解压到 `/Applications/DeskPet.app`
- 脱 macOS Gatekeeper quarantine 标记 —— **双击直接打开，不需要右键**

> 当前 repo 是 private 时：`export GH_TOKEN=<your-github-token>` 后再跑脚本。
> Public 时直接跑即可。

### 手动安装

如果不放心 `curl | bash`，到 [Releases](https://github.com/Ice-teapop/desktop-pet/releases) 自己下载 zip：

- **Apple Silicon**: `DeskPet-<version>-arm64-mac.zip`
- **Intel Mac**: `DeskPet-<version>-mac.zip`

解压 → 拖 `DeskPet.app` 到 `/Applications` → **右键** `DeskPet.app` → 打开（首次必须右键，因为没 Apple 公证；脱 quarantine 也可以在终端跑：`xattr -dr com.apple.quarantine /Applications/DeskPet.app`，之后双击就好）。

### 首次启动

启动后会引导配置 Anthropic API key（必需）+ 其它可选 keys 跟权限。详见下方「外部依赖」。

> Phase 1 暂时只出 `.zip`，不出 `.dmg`（dmg-builder + macOS Sequoia 兼容 bug，Phase 2 修）。
> Phase 2 计划补 Apple Developer 签名 + 公证，到时连脚本里的 `xattr` 步都不需要。

## 开发者打包发布

```bash
npm install
npm run build:mac
# 产物在 dist/
# - DeskPet-0.0.1-arm64-mac.zip   （Apple Silicon）
# - DeskPet-0.0.1-mac.zip         （Intel）
```

把 `.dmg` 上传到 GitHub Releases 即可。或自动化（需 `GH_TOKEN`）：

```bash
env GH_TOKEN=<your-github-personal-access-token> npm run build:mac -- --publish always
```

会自动建 draft release + 上传 artifacts。

## 已实现功能

- M0~M3 桌宠 UI / 状态机 / 前台 app 活动识别
- M4-A vision agentic（AI 通过 view_screen tool 自主决定是否截屏）
- M4-B local tools: clipboard / open_url / copy_to_clipboard / current_app_info
- M4-C local tools: read_file / list_directory / write_file / create_directory / find_files / delete_file / run_command / open_system_settings / read_system_preference + per-action approval modal + audit log
- M4-D web tools: fetch_url + web_search (Tavily)
