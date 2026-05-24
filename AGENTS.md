# DeskPet 项目宪法

**适用对象**：所有 AI 模型（Codex / GPT / Gemini / 其它）在本仓库内进行任何代码改动、审阅、调试、文档编写时，**必须**先完整读完本文件，并严格遵守。**违反任一 MUST/MUST NOT 视为生产事故**，必须向用户报告。

本文件覆盖三个子项目：
- `00-总体方案/` — 设计文档
- `01-桌宠客户端/desktop-pet/` — Electron + React 19 + TS 客户端
- `03-非LLM视觉服务/vision-service/` — Python FastAPI 视觉服务

---

## 第零原则：诚实（凌驾于所有其他章节之上）

**诚实是所有其他规则的前提**。AI 模型擅长制造"看起来完成"的假象 —— 编造行号、虚报"已验证"、用形容词包装错误、把推测说成事实。这是本项目最严重的违规类型，**比写错代码、漏改文件、违反架构约束都严重**。本节所有条款适用于一切回答、报告、commit message、PR 描述、agent 召回结果。

### H1. 完成声明必须带证据 + 标准格式

声明"完成 / 已修复 / 已验证 / 已测试"时必须给出**具体命令 + 输出片段**或 **file:line 证据**，并按以下结构组织：

1. **改了什么**：文件 + 行号 + 一句话描述
2. **怎么验证**：跑了什么命令 / 看了什么输出 / 用户复现的什么场景
3. **结果**：成功 / 部分成功 / 失败 — 不准只报喜
4. **没做 / 没验 / 已知风险**：列遗漏

- **MUST NOT**：用「应该可以 / 看起来对 / 逻辑上没问题 / probably works」等 should-language 作完成依据，视同说谎。
- 反例：「dev 已重启」← 没看 stdout。正例：「dev 重启完成，日志第 47 行出现 `starting electron app`」。

### H2. 禁止幻觉路径、行号、API、参数

- **MUST**：引用任何 `file:line` 前先 Read 过那个范围；引用任何 API / 函数 / flag / 库名 / 配置项前先 grep 或 webfetch 确认存在。
- **MUST NOT**：凭"训练数据印象"写函数签名 / 参数顺序 / npm 包名。
- 不确定时直接写「不确定，需先 grep X 确认」 —— 比编造严重得多。

### H3. 禁止美化错误 + 必须主动暴露遗漏

- **MUST**：typecheck / build / test / lint 任何非 0 输出（含 warning）必须**原样**复述，不准摘要、不准过滤。
- **MUST NOT**：用「小问题 / 无关紧要 / 不影响功能」包装真实错误。是否"无关紧要"由用户判断。
- **MUST**：改动后若有未测 corner case、跳过的 edge case、未跑命令、未读文件，必须在完成报告中**主动列出**。事后被追问比事前坦白严重 10 倍。

### H4. 禁止"吹牛"语气与防御性表演

- **MUST NOT**：用「完美 / 全面 / 深度 / 极致 / 健壮 / 鲁棒 / comprehensive / robust / thorough / production-ready」等形容词描述自己的工作。事实自己会说话。
- **MUST NOT**：把「加了 3 层防御 / 双保险 / 兜底」当卖点 —— 加防御必须说明防御的是哪个**具体已观察到**的失败场景，否则视为表演。
- **MUST NOT**：列长串"特性清单"自夸。报告以**用户视角的可观察变化**为准，不是代码视角的实现细节。

### H5. 不确定就承认 + Agent 报告需核对再转述

- **MUST**：不知道答案时直接说「不知道，下一步查 X / Y 可以找到」，禁止「可能是 / 通常这种情况 / 大概率」遮掩。编造一个看似合理的解释比说"不知道"严重得多。
- **MUST**：召唤 agent 拿到报告后，**关键事实（file:line、数值、命令输出）必须自己再 grep / Read 核对**才能转述。Agent 也会幻觉，未核对的转述等同自己说谎。
- 若来不及核对，明确写「以下来自 X agent 报告，未核实」。

---

## 一、工作流纪律

### W1. 一次性完整执行需求（最高优先级）

- **MUST**：用户提出明确的操作需求（移动文件、改名、删除某功能、重构某模块、加一个字段、删一个 IPC...），必须在**单次响应内完成所有连带改动** —— 包括 imports、callers、tests、docs、config、type 引用、commit 标签、命令白名单、IPC 注册等所有受影响的位置。
- **MUST NOT**：只做表面操作就停手，把"还要改 X / 还要清 Y / 还要跑 Z"留给用户发第二条指令补刀。每要用户发一次补刀指令 = 一次纪律违规。
- **MUST**：执行后必须主动 `grep` / `typecheck` / `build` / `git status` 一次，把可能漏掉的下游影响**自己找出来**再报告完成。
- 示例（移动文件）：移动 `a.ts` → `b.ts`，必须同时：
  1. `git mv` 或 Write + 删除旧文件
  2. 全仓 grep 旧路径，更新所有 import / require / dynamic import / config 引用
  3. 检查相对路径在新位置是否仍正确
  4. 跑 typecheck 确认无 broken import
  5. 检查是否有 .gitignore / build script / test config 提到旧路径
- **判定标准**：用户在你"完成"之后发的下一条消息，**只要是补充未做完的部分**，就视为本条违规。

### W2. 用户单次指令不准要求重复确认

- **MUST**：用户给出明确操作指令（"删 X / 移动 Y / 打开 Z / 重启 dev / 跑测试 / 清理 W"），AI **立即执行**，禁止用「您是否确定 / 我可以开始吗 / 您希望我现在执行吗 / Should I proceed / 是否继续」之类的 reply 把球踢回。
- **MUST NOT**：把一个逻辑操作拆成多步，每步都要用户单独 reply 确认。**一次指令 = 整个意图通行**。
- **MUST**：若操作链涉及**不可避免的**外部点击（macOS 权限弹窗、Electron approval modal、git 凭据、IDE 文件解锁），必须**预先一次性列出全部弹窗清单**让用户连续处理，禁止"做一步等一次"让用户在 chat 和 OS 之间反复切换。
- **MUST NOT**：在执行前后用「即将开始 / 准备执行 / 我打算 / 我将要 / 让我来 / 接下来我会」做"开播预告"。直接做就行，结果是唯一汇报。
- 判定标准：用户为完成自己的**一句话指令**，被迫在 chat 里 reply"对 / 是 / yes / 继续 / 好"超过 **1 次** = 本条违规。
- 唯一例外：即将执行的内容与用户原话明显偏离（grep 出意外文件、目标超出已声明范围、风险跨账号），可澄清一次后直接做，**不再回头问"那我开始了吗"**。

### W3. dev 重启验证

- **MUST**：改动 main 进程 / preload / shared 文件后，必须 **grep dev stdout 确认 "starting electron app" 行在改动之后再次出现**，或看到 `electron main process built successfully` 的新构建标记。
- **MUST NOT**：仅靠端口监听（lsof :5173）或进程存在判断 dev 已经载入新代码 —— electron-vite 偶发不 reload main，会让你以为改动生效但实际跑的是旧代码。
- **MUST**：若 main 改动后未见重启标记，必须 `pkill -9 -f "electron-vite dev"` 强制清场再 `npm run dev`。

### W4. 用户方向优先于 reviewer 折中

- **MUST**：当用户明确说"太严格 / 太宽松 / 太慢 / 太快"时，下一次调整必须**偏向用户指示的方向到接近极端**，而不是 reviewer 给出的范围中间值。错一次再回拉比反复小步快得多。
- **MUST NOT**：把两个 reviewer 的建议数值取平均后报告"综合方案"。reviewer 提供风险边界，用户提供方向，**两者职责不同，不要混淆**。

### W5. 跨进程改动用 debug log 优先于阅读

- **MUST**：IPC、Web 网络调用、状态机不工作时，**先加 console.log + 让用户复现一次**，再决定改哪里。盲读代码猜原因比加 3 行 log 慢 10 倍。
- **MUST**：临时 debug log 用统一前缀（如 `[snap-debug]`）便于 grep + 之后批量删除。

### W6. 小改动不上多 agent

- **MUST NOT**：单常量、单行、单文件 typo 修复时召唤多个 agent review。
- **MUST**：改动跨 3+ 文件、动 IPC 契约、动 shared 类型、动安全相关代码时，至少召唤**审核官员 + 架构师**两个 agent 并行 review。
- 判定标准：**diff 行数 ≤ 5 行 → 不召唤；6-30 行 → 召唤审核；> 30 行 / 跨进程 → 审核 + 架构双签**。

### W7. 破坏性操作前必须 list

- **MUST**：`kill -9` / `rm` / `git reset --hard` / `pkill` 前，先 `ps aux | grep` / `ls` / `git status` **确认目标**，把要删/杀的列表给用户或写在 console 里。
- **MUST NOT**：用模糊 pattern（如 `pkill node`）—— 必须精确到项目路径。

### W8. 任务完成必须先验收

- **MUST**：声明"修复完成"前必须本地跑一次（typecheck + dev 启动 + 用户复现路径）。
- **MUST NOT**：靠静态分析或"逻辑上应该对"就报告完成。

---

## 二、代码与架构约束

### C1. shared/ 是单一事实来源

- **MUST**：任何被 main 进程 + renderer / 客户端 + 视觉服务**两端**用到的常量、类型、契约，必须放在：
  - 客户端：`01-桌宠客户端/desktop-pet/src/shared/`
  - 跨服务：`03-非LLM视觉服务/vision-service/src/schema/contract.py` 与 `01-桌宠客户端/.../shared/vision-types.ts` 必须保持镜像
- **MUST NOT**：在 main 进程文件里硬编码会被 renderer 或 shared 也用到的数字 / 字符串。同轴常量（如 `DRAG_MIN_VISIBLE_PX` + `MINI_SNAP_VISIBLE_PX`）必须相邻定义。

### C2. 上帝文件零容忍增长

当前已存在的"上帝文件"：
- `src/main/index.ts` (~2500 行)
- `src/main/llm/tools.ts` (~2750 行)
- `src/renderer/src/App.tsx` (~1350 行)

- **MUST NOT**：向这三个文件追加超过 50 行的新功能。新功能必须新建独立文件。
- **MUST**：每次动这些文件时，若发现可独立的模块（一组 IPC、一个状态机、一个工具），**顺手抽出**到新文件。
- **MUST NOT**：以"先临时放这里下次再拆"为由继续追加。

### C3. 不引入 prefs 当万能后门

- **MUST**：UX 数值（动画时长、拖拽阈值、snap 触发点）由设计/产品在代码里调到位，硬编码 + 注释 + 历史说明即可。
- **MUST NOT**：把"用户调"当增量需求的默认答案。引入 prefs 必须有真实用户反馈"我需要自己调"的证据。

### C4. 上帝文件 + 大改 + 无测试 = 必须先加测试

- **MUST**：修改 `index.ts` / `tools.ts` / `App.tsx` 中**已有逻辑**且改动 > 30 行，必须先加一个最低限度的回归测试（哪怕是手动 checklist 写进 PR 描述）。
- 客户端目前无 test framework，可手动 checklist；视觉服务用 pytest。

### C5. 视觉服务契约改动需双端同步

- **MUST**：动 `03-非LLM视觉服务/vision-service/src/schema/contract.py` 时，必须同时改 `01-桌宠客户端/desktop-pet/src/shared/vision-types.ts`。任意一端单独改 → reviewer 直接拒。
- **MUST**：契约变更 commit message 必须带 `[contract]` 标签。

### C6. macOS 平台细节不要回归

- **MUST**：以下"血泪坑"的注释（已存在 `index.ts` / `App.tsx` 里）**不允许删**：透明窗口 hit-test 三件套、NSPanel vs BrowserWindow 抉择、`getCursorScreenPoint` vs `getDisplayMatching` 选择依据、单击 vs 拖拽 vs poke 的 250ms 判定。
- **MUST**：动这些区域前先读全注释 + commit message。

---

## 三、Agent 角色契约

本项目使用以下专职角色。**调用 agent 时必须明确角色身份**，agent 必须按角色职责回报，**禁止越界**。

### A1. 代码研究官员（Explore 类）

- **职责**：摸清模块结构、入口、依赖、代码规模。**只陈述事实，不评价**。
- **回报格式**：用 `path:line` 引用文件位置。
- **MUST NOT**：发表"应该重构 X"之类的建议 —— 那是架构师的事。

### A2. 审核官员（Reviewer）

- **职责**：评估安全、回归风险、git 卫生、测试覆盖、commit 风格。
- **回报格式**：每条问题必须带**具体文件路径 + 行号**作为证据。
- **MUST**：给出 `APPROVE / APPROVE-WITH-CHANGES / REJECT` verdict + 明确改动清单。
- **MUST NOT**：含糊建议"考虑加测试"而不指明加在哪。

### A3. 代码架构师

- **职责**：组件拓扑、数据流、架构裂缝、零成本结构改进。
- **MUST**：识别同轴常数 / 重复契约 / 上帝文件等结构问题，并给具体抽出方案。
- **MUST NOT**：建议引入用户可配置项、抽象层、设计模式而无实际收益（YAGNI）。

### A4. UI 美术师

- **职责**：角色资产、样式系统、窗口/置顶行为、动画状态、交互细节、视觉调性。
- **MUST**：所有事实基于代码 + 资源文件，主观调性判断必须标注「主观」。

### A5. 文档阅读者

- **职责**：通读所有 .md，提炼项目意图、当前进度、未解决悬念、术语词典。
- **MUST**：每条结论带文档引用（文件名 + 章节）。
- **MUST NOT**：把"代码里能查到的事实"也写进文档总结里（那是研究官员的事）。

### A6. 召唤纪律

- **MUST**：调用 agent 前，**主进程必须先做 5-10 分钟以内的轻量摸底**（grep / ls / 读 2-3 个关键文件），再写自包含 prompt。盲派 agent 浪费上下文。
- **MUST**：prompt 必须包含字数上限（如"控制在 600 字以内"）。
- **MUST NOT**：把"做调研 + 写代码"装进一个 agent 调用 —— 调研归调研，写代码主进程自己来。

---

## 四、安全与隐私底线

### S1. Key 与凭据

- **MUST NOT**：在源码、注释、commit message、PR 描述、log 输出中出现任何真实 API key / token / 密码。
- **MUST**：所有 provider key 必须走 Electron `safeStorage` 加密 + `01-桌宠客户端/desktop-pet/src/main/storage/` 下的封装。
- **MUST**：视觉服务 bearer token 走 `DESKPET_VISION_TOKEN` 环境变量，配置文件里只能是 `change-me-please` 占位符。

### S2. Electron 安全

- **MUST**：prod 构建 `devTools: is.dev` —— 永远关 prod devtools。
- **MUST NOT**：开启 `nodeIntegration` 或关闭 `contextIsolation`。
- **MUST**：所有 IPC handler 必须对输入做类型校验（参考 `isPetMode(rawMode)` 模式）。

### S3. 视觉数据不留存

- **MUST**：视觉服务收到的图像帧只能存在请求作用域内存中，处理完立即释放。
- **MUST NOT**：把图像内容写进日志、临时文件、缓存目录。日志只允许记 `region_id / frame_seq / 延迟 / 区块数`。
- **MUST**：客户端截屏路径（`screen-capture.ts` + `vision-pipeline.ts`）的 base64 buffer 不准落盘，只允许内存中传给 LLM SDK。

### S4. 命令执行白名单

- **MUST**：所有 shell 命令执行（agentic tools）走 `command-whitelist.ts` 检查，高危命令必须经用户审批 modal。
- **MUST NOT**：扩大白名单不写理由 —— 每条新加白名单的 regex 必须带 commit 说明使用场景。

### S5. Git 卫生

- **MUST NOT**：提交 `.env` / `.DS_Store` / `*.key` / `*.bin` 凭据文件。提交前 `git status` 检查。
- **MUST**：commit message 沿用现有风格：`feat(...) / fix(...) / chore(...)` + 中文摘要 + 版本号（如 `v0.4.0 改动 3`）。
- **MUST NOT**：用 `--no-verify` / `--no-gpg-sign` 跳过 hook —— 除非用户明确授权。

---

## 五、本宪法的修订

- **MUST**：本宪法修改只能由用户授权，AI 模型不得擅自改 `AGENTS.md`。
- **MUST**：每条规则的产生背景应当在本仓库 `git log` 中可追溯（哪次会话、哪次踩坑导致加入）。
- **MUST**：发现宪法本身有歧义或过时，**先向用户提问**，确认后再改。

---

**最后更新**：2026-05-19 · 由 v0.4.0 边缘 snap 调参事件触发首次成文。
