# careful-coder (cc) + careful-reviewer (cr) 在 DeskPet 项目的表现回顾

记录于 M3-3-D 完工后（2026-05-16），DeskPet 从空仓库到 GIF 真动画 + 活动识别 + .app
打包用了大约 24 小时密集协作。本文档反思两个 skill 的实际表现 + user 反馈，作为后续
prompt 优化参考。

## 时间线

| Milestone | 内容 |
|---|---|
| M0 / M0.5 | Electron + React + TS 脚手架 + 像素螃蟹 SVG 加载 |
| M1-1 ~ M1-8 | 状态机 / 托盘 / 点击穿透 / 对话框 UI |
| M2-1 | Anthropic SDK 流式 IPC |
| M2-2 | API key 加密存储 + 首启迎宾 + 多轮 cr 修复 |
| M3-1 | 打包成 .app + 原创 logo |
| M3-2 | 模型切换托盘 radio |
| M3-3 / -C / -D | 活动识别（osascript poll → Swift binary 事件驱动）+ GIF 真动画 |

## cc 表现

### 做得好的

1. **typed error 归类** (M2-1) — anthropic.ts 用 `instanceof Anthropic.AuthenticationError /
   RateLimitError / APIConnectionError / APIError` 而非字符串匹配。529 overloaded 没专属
   class 时用 `status === 529` 区分。体现了对 SDK 设计的理解。

2. **race 防御的架构级清理** (M2-2 cr-fix 累计) — 面对 cr 提的 chatHistory 污染，cc 不
   是补丁式而是引入三层防御：`chatTurnToken` 让 stream callback 自我屏蔽 + `queueCredentialOp`
   Promise 队列串行化文件 I/O + Swift binary 的 `AbortController` 真 abort SDK fetch。

3. **migration 思路** (M3-3 后续 fix) — user 报"重启 app 又问 key"后，cc 先定位到
   productName 变更导致 userData 路径割裂，初始用 `app.setName()`，user 实测仍问 →
   cc 重新分析时机问题，改 package.json productName + 写 migration helper 用 `fs.rename`
   原子搬迁，并处理"双路径都有时删 legacy"防"被遗忘的明文 key"。

4. **可选关闭设计** (M3-3) — detector 默认开但加托盘 checkbox 让 user 关「监视」感。
   tradeoff 透明化 + 尊重 privacy 偏好。

### 做得不够的

1. **顶部注释 docs-drift 反复 4 次** — M2-2 → cr-fix → M3-2 → M3-3-D，cr 每次都标
   ✨ "顶部注释没跟上"，cc 修 3 次后第 4 次又忘。说明"顶部 docstring 同步"没成为
   cc 工作流的硬步骤。

2. **资源边界 audit 缺失** — "动画单一" 是 user 直接反馈才意识到 themes/clawd-dev/
   只有 4 个 SVG（上游实际 45 SVG + 23 GIF）。cc 在 M3-3 实施前没主动 `ls upstream/`
   对比就开工，直接接受现状。

3. **默认参数 conservative** — POLL_MS=5000 是直觉值，user 明确"切 VSCode 立刻改变"
   后 cc 才推荐 500ms 折中方案，user 进一步要求"C 真 0 延迟"才上 Swift binary。
   cc 倾向"够用就行"而非"用户实际感知"。

4. **过度防御性参数** — M3-3-D 加 `<img key={gifUrl}>` 想"让 GIF 从第一帧播"，实际
   Chromium 设新 src 本来就重新解码。冗余防御导致 unmount/remount 1 帧透明闪烁，cr
   第二轮才发现。

5. **死代码遗留** — `pet:event:click` IPC 是 M1 demo 触发用，M2+ LLM 流主导后无人调
   用。cc 没主动清理直到 cr 找出来 + 顺便发现 LLM 流期间触发会撕烂 stateMachine。

### user 反馈节奏观察

user 偏好快节奏 —— 短指令多："cc 修" / "cr 查" / "走下一步" / "全做" 多为 ≤4 字。
verbose 报告 user 跳读。

少数主动重定向方向的时刻：

- **"用户存过一次 API 后直接做永久本地化"** — cc 原本设计 env 持久化，user 重定向到 BYOK 首启引导
- **"做一个启动项，app 格式"** — user 直接跳到打包阶段，cc 之前没规划
- **"C，0 延迟"** — user 拒绝 cc 折中方案（POLL_MS=500），要求真事件驱动
- **GIF URL** — user 主动提供更好资源，cc 之前假设 SVG 是唯一选项

## cr 表现

### 做得好的

1. **找到真正的 race** (M2-2) — `chatHistory` 在 `resetKey` 时被清空，但 in-flight
   stream onDone 仍 push assistant turn → 下次 messages 起头是 assistant → Anthropic 400。
   cc 完全没想到的链，cr 通过追时序找出。

2. **path drift 风险** (M3-1) — productName 改名时 cr 立刻标 🚫 BLOCKING 指出 dev vs prod
   userData 不互通，user 后来实测验证（重启 app 问 key）。判断精准。

3. **safe-but-not-clean 关注** — migration 用 copyFile 留 legacy 时 cr 要求改 rename
   删源，否则旧加密 key 永远残留在 desktop-pet/ 目录。cc 第一次没意识到这是同根问题。

4. **跨 dimension 状态 audit** — M3-2 setModel 时 cr 发现 thinking 状态没自动结束 +
   streaming 气泡 cursor-blink 会卡死。cc 当时只想到 chatHistory 污染，没 audit 渲染层
   显示状态。

### 做得不够的

1. **同类问题反复提示但没强制整改** — docs-drift 4 次都 ✨ nit + 类似话术。cr 没把
   "顶部注释同步"升到 ⚠️ 或要求 checklist。等同每次"温柔提醒"。

2. **speculative 标记偶尔过谨慎** — M3-3 "did-finish-load 推 key:state 时 React useEffect
   可能没 subscribe" 标 [speculative]，user 没遇到。但 cr 仍要求加 `key:request-state`
   防御性 ping。代码确实更稳但 user 视角是"加了看不到的修复"。

3. **少数 race 实际不可复现** — `savePreferences` 连切丢 race 需要 200ms 内连切 4 次
   模型才触发。cc 加 debounce 修，实际场景几乎不发生。可能 over-engineering。

### 评判 cr 客观性

| 严重度 | 实际可见率（user 普通使用复现）|
|---|---|
| ⚠️ should-fix | 约 60% — 例如 setModel stuck cursor、流式中切模型 abort、stuck thinking GIF |
| 💡 suggestion | 约 80% 有工程价值 — 其余偏纸面 |
| ✨ nit | 约 90% 有维护价值 — 多为 docs / 命名 |

## user 直接反馈关键时刻

| 时刻 | 反馈 | cc/cr 学到 |
|---|---|---|
| 重启 .app 又问 key | "用户存过一次后做永久本地化" | productName 路径割裂（cc 应主动 audit）|
| 动画单一 | "为什么现在这么单一" | 资源边界没 audit |
| 切 app 5s 延迟 | "vs code 切后台时立刻改变" | 默认参数挑战 |
| user 给 GIF URL | （主动提供更好资源）| cc 不该假设 SVG 是唯一选项 |

## 流程层面观察

### 优点

- **cc 实现 → cr 验证 → cc 修 → cr 复审** 四步循环让 bug 在 commit 前被发现
- **cr 强制每个 ⚠️ 都要 file:line + quote + scenario**，逼 cc 写出可追溯的注释
- **fast iteration** —— M0-M3 在 24 小时内完成，cc/cr 没拖累节奏

### 缺点

- **顶部注释 / 死代码 / docs 类问题不能自愈** —— cr 反复提，cc 修了忘
- **资源边界缺自动 audit** —— 不先 ls 上游就开工
- **默认参数 conservative** —— "够用就行"而非"用户感知"
- **没有 retrospective 反馈机制** —— 每个 M 完了有 cr，但没把模式 feed 回 cc 的 working memory

## 改进建议

### 给 cc

1. **资源 audit 作为 Step 2 标配** —— 写新 feature 前先 `ls` / grep 相关目录确认
   边界（"我有几个 SVG / 上游有几个 / 现有 IPC 是什么"），不假设默认值
2. **顶部 docstring 同步进 Step 3 checklist** —— 每次改 main/index.ts 必须更新顶部
   注释；建议放进 self-check-protocol
3. **默认参数 review** —— 写 poll / timeout / debounce 时多想一步"用户会感知吗"
4. **防御性参数自审** —— 加 `key=` / `try-catch` / `if (...) return` 前问"不加会出
   什么 bug"，避免冗余防御
5. **死代码主动清理** —— 每次新加 IPC / state 时 review 之前的有没有被遗弃

### 给 cr

1. **同类问题升级** —— 连续 N 次同类型 ✨ → 自动升 ⚠️，逼 cc 系统修而非补丁
2. **可重现性标注** —— 每个 ⚠️ 加"user 视角可见？"标签，让 cc 优先修能 reproduce 的
3. **少推 speculative** —— [speculative] 数 > 实测 finding 数时主动节制
4. **拒绝过度防御** —— cc 加冗余的 catch / key / try 时 cr 标 ⚠️ "过度防御"

### 给工作流整体

- **每个 milestone 完工时做一次 retrospective**（不只 cr 找 bug，还反思 cc/cr 模式）
- **维护一个 lessons-learned 文档**（就是这一份），跨 milestone 累积模式
- **user 反馈"为什么 X"时** —— 第一步不是改代码，是问"我假设了什么没验证的事"

## 结论

cc + cr 配对在 DeskPet 这种密集 prototype 项目上是**显著加速器**：1 user + 1 AI 在
1 天内交付了原本需要 1 周的功能集（Electron 桌宠 + LLM + 加密 key + 模型切换 + 活动
识别 + GIF 动画 + .app 打包）。

主要不足在 cc 的**资源边界 audit 缺失**和 cr 的**同类问题升级机制**。两者都可以通过
prompt 调整解决（见上文「改进建议」）。

代价：cr 偶尔 over-engineering 让 cc 加进不必要代码（如 `key={gifUrl}` 反例）。但相比
cr 找出的真 bug（chatHistory 污染、stuck cursor、env 死循环、productName 路径割裂），
代价值得。
