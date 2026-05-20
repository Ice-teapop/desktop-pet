# DeskPet

> 桌面上一只像素小螃蟹陪你写代码 — Electron + React + TypeScript 透明置顶桌宠，背后是多 provider AI 助手（Anthropic / OpenAI / Google / xAI / DeepSeek / 字节豆包）。

当前版本 **v0.4.12**（[最新 release](https://github.com/Ice-teapop/desktop-pet/releases/latest)）。21 个 sprite 像素螃蟹主题 [deskpet-cc](themes/deskpet-cc/) 致敬 Claude Code 公开形象。

---

## 给普通用户：1 行命令装

```bash
curl -fsSL https://raw.githubusercontent.com/Ice-teapop/desktop-pet/main/scripts/install.sh | bash
```

脚本自动：检测架构（M 芯片 / Intel）→ 拉最新 zip → 解压到 `/Applications/DeskPet.app` → 脱 macOS Gatekeeper quarantine → 双击直接打开（不需要右键）。

不放心 `curl | bash` 就到 [Releases](https://github.com/Ice-teapop/desktop-pet/releases) 自己下：
- Apple Silicon：`DeskPet-<version>-arm64-mac.zip`
- Intel Mac：`DeskPet-<version>-mac.zip`
- Windows：`DeskPet-<version>-setup.exe`
- Linux：`DeskPet-<version>-x86_64.AppImage` / `_amd64.deb`
- 英文版加 `-EN` 前缀

手动安装的话首次需要右键 → 打开（绕 Gatekeeper，没 Apple 公证），或在终端跑 `xattr -dr com.apple.quarantine /Applications/DeskPet.app`。

---

## 首次启动

启动后桌面右下角出现像素螃蟹 + 一个空对话框。引导你：
1. 配 LLM provider key（至少 1 个，见下方）
2. 可选：装 Tavily key 让 AI 联网搜
3. 可选：开 macOS 屏幕录制权限让 AI 看屏

桌宠交互：
- 单击 → 切换对话框开关
- 双击 → 跳一跳反应
- 4 连击 → 不耐烦东张西望
- 拖拽 → 换位置
- 60s 不动 → 打哈欠 → 犯困 → 倒下 → 睡着；点一下醒过来
- 60s 没活动 → 进入 mini 模式（屏幕边探头招手）

---

## LLM Providers（至少装 1 个）

所有 key 通过 Electron safeStorage AES-256 加密落盘（macOS Keychain backed），绝不上传第三方。

| Provider | 适用场景 | 注册 URL |
|---|---|---|
| **Anthropic Claude** | vision + tools 一流，Haiku 速度+成本最佳（推荐入门） | <https://console.anthropic.com> |
| **OpenAI** | GPT-4o + 推理 model（o1 / o3） | <https://platform.openai.com/api-keys> |
| **Google Gemini** | 免费 tier 1500 次/天 + 原生 Search grounding | <https://aistudio.google.com/apikey> |
| **xAI Grok** | 独家实时 X feed search | <https://console.x.ai> |
| **DeepSeek** | 性价比极高 + R1 推理思考可见 | <https://platform.deepseek.com/api_keys> |
| **字节豆包** | 国内访问稳定 | <https://console.volcengine.com/ark> |

设 key 路径：桌宠 → Settings → providers section → 粘对应 key。也支持 ENV 变量 dev 后门：`ANTHROPIC_API_KEY=sk-ant-... npm run dev` 优先于落盘 key。

---

## 可选：Tavily Search（AI 联网搜）

启用后 AI 可自主调 `web_search` tool 查互联网。免费 tier **1000 queries/月**。

1. 注册 <https://tavily.com>（邮箱即可，无信用卡）
2. Dashboard 复制 `tvly-...` key
3. 桌宠对话区点 **「🔍 设搜索 key」** → 粘 key → 按钮变 **「🔍 搜索就绪」**

不配 key 也能用 `fetch_url` tool 让 AI 抓你给的具体 URL。

---

## 可选：macOS 屏幕录制权限（让 AI 看屏）

启用 `view_screen` tool 必需。

1. 桌宠对话区点 **「🔒 启用屏幕感知」** → 隐私 modal → 「我已了解，启用」
2. 系统弹「DeskPet 想录制屏幕」权限请求 → 允许
3. 没弹的话：**系统设置 → 隐私与安全性 → 屏幕录制** → 加 `DeskPet.app`（dev 模式下是 `node_modules/electron/dist/Electron.app`）
4. **完全退出 DeskPet 重启**（macOS 权限传播要求）
5. 重启后按钮变 **「👁 允许 AI 看屏」** —— 发消息时 AI 自主决定是否截屏

---

## 文件系统访问

无需配置。AI 可调 `read_file` / `write_file` / `list_directory` / `find_files` / `create_directory` / `delete_file` 等 tool。

**默认信任范围**：`~/Documents` `~/Downloads` `~/Desktop` `~/Projects` `~/notes` 等 HOME 下顶级目录 —— AI 在范围内读写无需确认。

**永远拒绝**：`~/.ssh` `~/.aws` `Keychain` 浏览器数据目录 `.env` 文件等敏感路径。

**首次访问其它目录**（如 `~/.config/git/config`）弹审批 modal，4 选项：拒绝 / 允许一次 / 信任此目录（本会话）/ 永久信任。

`delete_file` 永远弹 modal（不可逆操作）。

---

## 终端命令执行

无需配置。AI 可调 `run_command` tool。

- **白名单**（`ls` / `cat` / `pwd` / `git status,log,diff,branch` / `ps` / `df` / `which` / `brew list` / `npm list` / `pip list` 等只读）静默执行
- **其它命令**弹审批 modal
- **永远拒绝**：`sudo` / `rm -rf /` 或 `~` / `curl|sh` / `dd` / `mkfs` / `chmod +s`

---

## 数据隐私

- **API keys**：safeStorage 加密落盘，绝不上传
- **截屏**：仅内存 base64 → 发 provider → 本地立即释放，不写盘（进程 core dump 也禁了）
- **剪贴板**：仅 AI 显式调 `read_clipboard` 时读，且 system prompt 教 AI 见 password/secret 时不复述
- **文件操作审计**：本地 `~/Library/Application Support/DeskPet/audit.log`（JSONL，5MB 自动滚动），不上传
- **聊天历史**：本地 SQLite，不同步任何云

---

## 已实现功能

**桌宠**
- 透明 always-on-top 窗口 + 多状态机（idle / yawning / dozing / collapsing / sleeping / wake / thinking / typing / building / juggling / sweeping / conducting / carrying / poked / looking_around / waking / drag / success / error / awaiting）
- 21 个像素 sprite + 14 种 LLM 流 / 反应 / 工作 / 睡眠状态切换
- mini mode 屏幕边停靠 + peek 探头招手
- 4.6s 巫师帽事故 sequence（4 专家联合设计）
- 自动更新检查 + 头顶通知动画

**AI 引擎**
- 6 provider fallback chain（anthropic → openai → google → xai → deepseek → bytedance）
- 18 个本地 agentic tools（vision / clipboard / open_url / file ops × 7 / run_command / fetch_url / web_search / set_pet_animation / 等）
- 各 provider 原生 server-side tool 集成（anthropic_web_search / anthropic_code_execution / openai_web_search / openai_code_interpreter / google_search / google_url_context / xai_live_search / xai_web_search）
- per-action approval modal + 完整 audit log
- 多模态：视觉 + 文本 + 工具循环

**集成**
- macOS 前台 app 活动识别（Swift binary frontmost-listener）→ 触发对应 pet 动画（coding 用 typing / terminal 用 search / chatting 用 conducting）
- chat history 持久化（SQLite）+ pet memory（pet-memory.md）+ user profile

---

## 开发者：本地跑

```bash
npm install
npm run dev          # 开发模式，main / preload / renderer 三端 HMR
npm run typecheck    # 双 config tsc 校验
npm run build        # production build (typecheck + electron-vite build)
npm run start        # 跑 production preview
npm run lint         # eslint
npm run format       # prettier --write
```

**打包**

```bash
npm run build:mac          # macOS zip (Apple Silicon + Intel)
npm run build:win          # Windows nsis installer (x64 + arm64)
npm run build:linux        # AppImage + deb

# 英文版（productName=DeskPet-EN，并行同住）
npm run build:mac:en
npm run build:win:en
npm run build:linux:en
```

产物在 `dist/`。

**推荐 IDE**：[VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

---

## 开发者：自动发版

仓库 `.github/workflows/release.yml` 监听 `v*` tag push 自动触发 multi-platform build + 上传 draft release。

```bash
# 1. bump version
npm version patch  # 或 minor / major

# 2. push tag 触发 CI
git push origin main --tags

# 3. CI ~5 分钟后产出 16 个 artifacts（ZH 8 + EN 8）

# 4. publish 为 latest
gh release edit v0.4.12 --draft=false --latest
```

GH Actions 在 GitHub web UI 可看进度。

> Phase 1 暂时只出 `.zip` 不出 `.dmg`（dmg-builder + macOS Sequoia 兼容 bug）。Phase 2 计划补 Apple Developer 签名 + 公证。

---

## 鸣谢

特别感谢 **[@rullerzhou](https://github.com/rullerzhou-afk)** ——

- 无偿提供了 [pet-forge](https://github.com/rullerzhou-afk/pet-forge)（MIT）这套 SVG 桌宠制作 skill + 完整工作流
- 在 Claude Code 小螃蟹形象设计 / 像素动画规范 / 状态衔接节奏上给予关键指导
- 全程持续的鼓励与耐心带教

本项目 [deskpet-cc 主题](themes/deskpet-cc/) 的 21 个 sprite 全部参考 pet-forge 的 SVG 路线规范创作；睡眠链 / 打字 / 巫师事故 / 抛球 / 招手 / 锤击 等动画 keyframes 节奏直接借鉴老 Clawd 设计语言。

没有她的开源精神和细致带教，DeskPet 桌宠形象不可能在这么短时间内完成从零到 21 个 sprite 的全套替换。**一切归功于她。**

完整鸣谢见 [v0.4.12 release notes](https://github.com/Ice-teapop/desktop-pet/releases/tag/v0.4.12)。

---

## License

MIT
