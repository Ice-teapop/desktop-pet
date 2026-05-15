const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require("docx");

const FONT = "Microsoft YaHei";
const border = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] }); }
function h3(t) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] }); }
function p(t) { return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(t)] }); }
function bul(t) { return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] }); }
function code(t) { return new Paragraph({ spacing: { after: 20 }, shading: { fill: "F2F2F2", type: ShadingType.CLEAR }, children: [new TextRun({ text: t, font: "Consolas", size: 19 })] }); }
function callout(title, body) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "C9A227" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "C9A227" }, left: { style: BorderStyle.SINGLE, size: 18, color: "C9A227" }, right: { style: BorderStyle.SINGLE, size: 1, color: "C9A227" } },
      margins: { top: 120, bottom: 120, left: 200, right: 160 },
      shading: { fill: "FBF6E3", type: ShadingType.CLEAR }, width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, bold: true, color: "8A6D00" })] }),
        ...body.map((b) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: b, size: 20 })] })),
      ],
    })] })],
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    borders, margins: cellMargins,
    width: { size: opts.w, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!opts.bold, color: opts.color })], alignment: opts.align })],
  });
}
function table(colWidths, header, rows) {
  const total = colWidths.reduce((a, b) => a + b, 0);
  const headRow = new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, { w: colWidths[i], bold: true, fill: "2E5C8A", color: "FFFFFF" })) });
  const bodyRows = rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, { w: colWidths[i], fill: ri % 2 ? "F2F5F8" : "FFFFFF" })) }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: colWidths, rows: [headRow, ...bodyRows] });
}

const children = [];

// Cover
children.push(
  new Paragraph({ spacing: { before: 2200, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "桌宠动画引擎与状态机", bold: true, size: 52, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "细化设计文档", bold: true, size: 34 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1000 },
    children: [new TextRun({ text: "智能桌宠助手 DeskPet — 子模块设计 · 5.1 章节展开", size: 24, color: "595959" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "桌宠动画引擎与状态机 — 细化设计"],
  ["所属方案", "智能桌宠助手 DeskPet 完整方案设计文档"],
  ["版本", "v1.0"],
  ["日期", "2026-05-15"],
  ["资源方案", "复用 clawd-on-desk 仓库的 SVG 动画与 CSS（开发期）"],
  ["产品定位", "操作型 Agent 桌宠（与 clawd 的观察型不同）"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1
children.push(h1("一、概述与设计目标"));
children.push(p("本文档是《智能桌宠助手 DeskPet 完整方案设计文档》中 5.1「桌宠窗口与动画引擎」的细化展开，专注于动画状态机的设计。"));
children.push(p("根据需求确认，本产品是「操作型」Agent 桌宠：桌宠会自己执行文件操作、命令等任务。因此它的动画状态由「桌宠自身的任务执行进度」驱动，而不是像 clawd-on-desk 那样由「外部 AI 编程工具的 hook 事件」驱动。"));
children.push(p("动画资源（SVG + CSS 关键帧）按用户决定，直接复用 clawd-on-desk 仓库 —— 但需注意授权问题（见第二章）。"));
children.push(h2("1.1 设计目标"));
children.push(bul("状态清晰：用户一眼能看出桌宠当前在干什么（空闲 / 思考 / 执行 / 等确认 / 出错 / 完成）；"));
children.push(bul("不打扰：动画切换平滑，永不抢焦点，空闲时降耗；"));
children.push(bul("资源可插拔：动画资源做成「主题包」，开发期用 clawd 素材，发布前可整体替换；"));
children.push(bul("可扩展：未来新增状态 / 主题不需要改状态机核心逻辑。"));

// 2
children.push(h1("二、资源方案：复用 clawd-on-desk"));
children.push(h2("2.1 复用内容"));
children.push(p("clawd-on-desk 的动画资源层是经过验证的、可直接借鉴的部分，具体复用："));
children.push(table([2600, 6760], ["复用项", "说明"], [
  ["SVG 动画素材", "assets/svg/ 下 39 个像素风 SVG（含 8 个极简模式动画）"],
  ["CSS 关键帧动画", "动画由 SVG 内嵌的 CSS @keyframes 驱动，无需 JS 逐帧"],
  ["切换机制", "渲染层预加载所有 SVG，状态切换时做交叉淡入（crossfade）"],
  ["窗口外壳做法", "透明 / 无边框 / 始终置顶 / 不可聚焦的 Electron 窗口 + 透明区域点击穿透"],
  ["辅助特性", "眼球追踪、任意状态拖拽（Pointer Capture 防丢失）、位置记忆、单实例锁"],
]));
children.push(h2("2.2 授权与合规说明（重要）"));
children.push(callout("⚠️ 必须先处理的授权问题", [
  "1）许可证不一致：clawd-on-desk 的 README 写的是 MIT，但 GitHub 仓库识别出的 License 标签是 AGPL-3.0。这两者差别极大 —— AGPL-3.0 是强传染性的 copyleft 协议，若按 AGPL 理解，你的产品一旦分发就可能被要求整体以 AGPL 开源。发布前必须向仓库作者确认实际授权，不能凭 README 的「MIT」字样想当然。",
  "2）角色 IP：Clawd（像素螃蟹）这个角色形象的版权归属 Anthropic，clawd-on-desk 自己也声明是非官方社区作品。直接拿 Clawd 形象做你自己的产品对外发布，存在 IP 风险。",
  "建议：clawd 的素材仅用于「开发期原型 / 联调」，把动画资源层设计成可插拔的「主题包」；任何对外发布版本，都替换成你自己原创的角色美术，并把 CSS / 状态机这类「思路」吸收为自研代码，而不是直接照搬带版权的素材文件。",
]));
children.push(h2("2.3 主题包（Theme Pack）架构"));
children.push(p("为同时满足「现在直接用 clawd 素材」和「将来能换成原创角色」，把资源层抽象为主题包："));
children.push(bul("一个主题包 = 一个目录：包含所有状态对应的 SVG / 动画文件 + 一份 manifest.json；"));
children.push(bul("manifest.json 描述：主题名、作者、每个「状态 ID」映射到哪个动画文件、默认帧率 / 时长；"));
children.push(bul("状态机只认「状态 ID」，不关心具体文件 —— 换主题 = 换目录，状态机零改动；"));
children.push(bul("开发期内置主题 = 「clawd-dev」（clawd 素材）；发布期默认主题 = 你的原创角色。"));
children.push(code('themes/clawd-dev/manifest.json'));
children.push(code('{'));
children.push(code('  "name": "clawd-dev",'));
children.push(code('  "fps": 12,'));
children.push(code('  "states": {'));
children.push(code('    "idle":     { "file": "idle.svg",    "loop": true  },'));
children.push(code('    "thinking": { "file": "think.svg",   "loop": true  },'));
children.push(code('    "success":  { "file": "happy.svg",   "loop": false, "minMs": 1500 }'));
children.push(code('  }'));
children.push(code('}'));

// 3
children.push(h1("三、状态清单"));
children.push(p("clawd-on-desk 有 12 种状态，但其语义是「观察 AI 编程工具」。我们把它重新映射为「操作型桌宠自身的任务状态」，复用对应的 clawd 动画素材。"));
children.push(table([1900, 1500, 3000, 1480, 1480],
  ["状态 ID", "中文名", "触发场景", "复用 clawd 动画", "可循环"],
  [
    ["idle", "待机", "无任务，空闲（含眼球追踪）", "待机", "是"],
    ["thinking", "思考", "Agent 正在理解意图 / LLM 生成中", "思考", "是"],
    ["working", "执行中", "正在调用工具（读文件、搜索等）", "打字", "是"],
    ["moving", "搬运", "文件移动 / 重命名 / 复制操作", "搬运", "是"],
    ["organizing", "整理", "批量整理 / 清理文件", "扫地", "是"],
    ["multitask", "多任务", "多个操作并行执行", "杂耍(1) / 指挥(2+)", "是"],
    ["building", "重任务", "长耗时、多步骤的复合任务", "建造", "是"],
    ["awaiting", "等待确认", "L2/L3 敏感操作弹出确认卡片，等用户决定", "通知", "是"],
    ["error", "报错", "操作失败 / 命令出错", "报错(冒烟)", "否"],
    ["success", "完成", "任务成功完成", "开心", "否"],
    ["sleep", "睡眠", "长时间无操作（睡眠序列）", "睡觉", "是"],
    ["drag", "拖拽", "正被用户拖动（叠加态，松手恢复）", "（沿用当前帧）", "—"],
  ]));
children.push(callout("设计要点：awaiting「等待确认」是操作型桌宠的核心状态", [
  "clawd 的「通知」状态只是个轻提示。但对操作型桌宠来说，「等待确认」承担着安全机制的关键一环 —— 桌宠执行敏感操作前必须停下来等用户点「允许 / 拒绝」。这个状态要做得醒目（举牌、感叹号），且必须是高优先级，不能被其它状态盖掉。",
]));

// 4
children.push(h1("四、状态触发源：Agent 引擎事件"));
children.push(p("clawd-on-desk 的状态来自 Claude Code 的 hook 事件（经本地 HTTP 服务上报）。我们的状态来自自己 Agent 引擎的内部事件 —— 直接在主进程内通过事件总线发出，不需要 HTTP 服务。"));
children.push(h2("4.1 触发机制对比"));
children.push(table([2200, 3580, 3580], ["", "clawd-on-desk（观察型）", "DeskPet（操作型）"], [
  ["事件来源", "外部 AI 工具的 hook", "自身 Agent 引擎的执行生命周期"],
  ["传输方式", "hook 脚本 → HTTP POST 到 127.0.0.1:23333", "主进程内事件总线 → IPC 推送渲染进程"],
  ["事件示例", "UserPromptSubmit / PreToolUse / Stop", "intent.start / tool.call / confirm.request / task.done"],
]));
children.push(h2("4.2 Agent 引擎事件清单"));
children.push(table([2600, 2400, 4360], ["事件", "→ 目标状态", "说明"], [
  ["intent.start", "thinking", "收到用户输入，开始理解意图 / 规划"],
  ["llm.streaming", "thinking", "LLM 正在流式生成回复"],
  ["tool.call(read/search)", "working", "调用读类工具"],
  ["tool.call(move/copy/rename)", "moving", "调用文件搬运类工具"],
  ["tool.call(batch organize)", "organizing", "批量整理 / 清理"],
  ["tool.call(run_command)", "building", "执行命令 / 脚本类重任务"],
  ["tool.parallel(n)", "multitask", "n 个工具并行（n=1 杂耍，n≥2 指挥）"],
  ["confirm.request", "awaiting", "弹出敏感操作确认卡片，等待用户"],
  ["tool.error / task.fail", "error", "工具调用失败 / 任务失败"],
  ["task.done", "success", "任务成功完成"],
  ["idle.timeout(60s)", "sleep", "60 秒无任何事件"],
  ["（无事件）", "idle", "默认态"],
]));

// 5
children.push(h1("五、状态机设计"));
children.push(h2("5.1 优先级模型"));
children.push(p("当多个事件在短时间内发生（例如并行任务 + 一个出错），状态机按优先级决定显示哪个状态。借鉴 clawd 的「多会话解析到最高优先级」思路。"));
children.push(table([1400, 2000, 5960], ["优先级", "状态", "理由"], [
  ["1（最高）", "awaiting 等待确认", "涉及安全，必须让用户立刻看到，不能被盖"],
  ["2", "error 报错", "出错需要用户注意"],
  ["3", "drag 拖拽", "用户正在直接交互，叠加于其它状态之上"],
  ["4", "success 完成", "短暂庆祝动画，需保证播完"],
  ["5", "building / multitask / moving / organizing / working", "执行类状态，按事件最新值"],
  ["6", "thinking", "思考态"],
  ["7（最低）", "sleep / idle", "空闲态，最容易被打断"],
]));
children.push(h2("5.2 最小显示时长（minMs）"));
children.push(bul("每个状态可在主题 manifest 里配置 minMs，进入后至少显示这么久才允许切走（拖拽、等待确认这类高优先级可打断除外）；"));
children.push(bul("作用：防止任务很快时动画「闪一下」就没了，造成视觉抖动；"));
children.push(bul("典型值：success ≈ 1500ms、error ≈ 1200ms、working ≈ 400ms、thinking ≈ 300ms。"));
children.push(h2("5.3 多任务并发解析"));
children.push(p("Agent 可能同时跑多个工具调用。状态机维护一个「活跃任务集合」，每次有任务开始 / 结束就重新计算应显示的状态："));
children.push(bul("活跃任务数 ≥ 2 → multitask（指挥）；"));
children.push(bul("活跃任务数 = 1 → 按该任务类型映射（working / moving / building…）；"));
children.push(bul("活跃任务数 = 0 → 看是否有待确认 → 否则回落到 idle；"));
children.push(bul("任一任务报错 → 临时切 error（受 minMs 保护），播完再回落。"));
children.push(h2("5.4 状态转移规则表"));
children.push(table([2400, 3480, 3480], ["当前状态", "触发条件", "转移到"], [
  ["idle", "intent.start", "thinking"],
  ["idle", "60s 无事件", "sleep"],
  ["sleep", "任意事件 / 鼠标移动", "惊醒动画 → 对应状态 / idle"],
  ["thinking", "tool.call", "working / moving / building…"],
  ["thinking", "confirm.request", "awaiting"],
  ["working*", "更高优先级事件（confirm/error）", "awaiting / error"],
  ["working*", "所有任务结束且无确认", "success（播完）→ idle"],
  ["awaiting", "用户点「允许」", "回到对应执行状态"],
  ["awaiting", "用户点「拒绝」", "idle（或 thinking 继续对话）"],
  ["error", "minMs 到期", "回落到活跃任务状态 / idle"],
  ["任意", "鼠标按下角色本体", "drag（叠加），松手恢复"],
]));

// 6
children.push(h1("六、渲染层设计（复用 clawd 思路）"));
children.push(bul("窗口：BrowserWindow 设 transparent:true、frame:false、alwaysOnTop:true、focusable:false、skipTaskbar:true、hasShadow:false；"));
children.push(bul("点击穿透：默认 setIgnoreMouseEvents(true,{forward:true})，鼠标进入角色实体像素时关穿透、离开时恢复；"));
children.push(bul("SVG 预加载：启动时把当前主题所有 SVG 读入内存 / DOM，切换时不产生加载延迟；"));
children.push(bul("交叉淡入：切状态时，新旧两层 SVG 叠加做 opacity 过渡（约 150–200ms），避免硬切闪烁；"));
children.push(bul("眼球追踪：idle 状态下监听全局鼠标坐标，驱动角色眼球 / 身体微倾的 CSS 变量；"));
children.push(bul("拖拽：renderer 用 Pointer Capture 接管拖动，主进程同步窗口位置并持久化；"));
children.push(bul("IPC：主进程状态机算出状态后，通过 contextBridge 白名单通道把「状态 ID」推给 renderer。"));
children.push(h2("6.1 数据流"));
children.push(code("用户输入 / 任务进度"));
children.push(code("  → Agent 引擎发出事件 (intent.start / tool.call / confirm.request ...)"));
children.push(code("  → 主进程状态机 (优先级 + minMs + 多任务解析)"));
children.push(code("  → IPC 推送「状态 ID」"));
children.push(code("  → renderer 按主题 manifest 找到 SVG → 交叉淡入切换"));

// 7
children.push(h1("七、特殊状态详解"));
children.push(h2("7.1 待机与睡眠序列"));
children.push(bul("idle：呼吸 + 眨眼 + 眼球追踪；"));
children.push(bul("60 秒无事件进入 sleep 序列：打哈欠 → 打盹 → 倒下 → 睡着（沿用 clawd 的分段做法）；"));
children.push(bul("任意事件或鼠标移动触发「惊醒弹起」动画，再进入目标状态。"));
children.push(h2("7.2 等待确认（awaiting）—— 安全关键"));
children.push(bul("最高优先级，进入后除「用户做出选择」外不被任何状态打断；"));
children.push(bul("动画醒目：举牌 / 感叹号 / 轻微跳动，吸引注意但不刺眼；"));
children.push(bul("与安全网关联动：确认卡片由 UI 层弹出，桌宠动画只负责「表达正在等」；"));
children.push(bul("超时策略：长时间未确认则维持 awaiting（绝不自动放行），可配置降为「极简提醒」。"));
children.push(h2("7.3 报错（error）"));
children.push(bul("受 minMs 保护，保证「冒烟 / ERROR」动画播完；"));
children.push(bul("播完按多任务解析回落；若整个任务失败则回 idle；"));
children.push(bul("可叠加一次性气泡提示错误摘要（由对话 UI 负责）。"));

// 8
children.push(h1("八、交互动作"));
children.push(table([2200, 7160], ["操作", "响应（复用 clawd 交互）"], [
  ["左键拖拽", "进入 drag 叠加态，Pointer Capture 跟随，松手恢复当前状态并记忆位置"],
  ["双击", "戳一下反应动画（一次性，播完回落）"],
  ["连点 4 下", "东张西望彩蛋动画"],
  ["单击", "呼出 / 收起对话输入框（DeskPet 新增，clawd 无此功能）"],
  ["右键", "功能菜单：对话、审计日志、只读模式、极简模式、设置、退出"],
  ["拖到屏幕右边缘", "进入极简模式"],
]));

// 9
children.push(h1("九、极简模式"));
children.push(p("完整复用 clawd-on-desk 的极简模式设计：桌宠藏在屏幕边缘只露半身，最小化存在感，但仍保留关键提醒能力。"));
children.push(table([2400, 6960], ["触发", "极简反应"], [
  ["默认", "呼吸 + 眨眼 + 偶尔手臂晃动 + 眼球追踪"],
  ["鼠标悬停", "探出身体 + 招手（向屏幕内侧滑出约 25px）"],
  ["awaiting 等待确认 / error", "感叹号弹出 + 挤眼，确保安全相关提醒在极简模式也能被看到"],
  ["success 完成", "花花 + 眯眼 + 星星闪烁"],
  ["peek 时点击", "退出极简模式（抛物线跳回）"],
]));

// 10
children.push(h1("十、实现要点与伪代码"));
children.push(h2("10.1 状态机核心（主进程，伪代码）"));
children.push(code("class PetStateMachine {"));
children.push(code("  activeTasks = new Map()   // taskId -> taskType"));
children.push(code("  current = 'idle'; enteredAt = now()"));
children.push(code(""));
children.push(code("  onEvent(evt) {"));
children.push(code("    updateActiveTasks(evt)              // 维护活跃任务集合"));
children.push(code("    const target = resolve()           // 优先级 + 多任务解析"));
children.push(code("    if (canSwitch(target)) switchTo(target)"));
children.push(code("  }"));
children.push(code(""));
children.push(code("  canSwitch(target) {"));
children.push(code("    if (priority(target) < priority(current)) return true"));
children.push(code("    return now() - enteredAt >= minMs(current)   // 受最小时长保护"));
children.push(code("  }"));
children.push(code(""));
children.push(code("  switchTo(s) { current = s; enteredAt = now(); ipc.send('pet:state', s) }"));
children.push(code("}"));
children.push(h2("10.2 待办清单"));
children.push(bul("M1：搭窗口外壳（照 clawd 做法）+ 接入 clawd-dev 主题包 + 实现状态机核心 + idle/thinking/working/success 四态打通；"));
children.push(bul("M1：实现交叉淡入、眼球追踪、拖拽、位置记忆、单实例锁；"));
children.push(bul("M2：接入 awaiting 状态并与安全网关联动（这是安全机制的一部分）；"));
children.push(bul("M2：补齐 moving/organizing/error 等执行态；"));
children.push(bul("M3：multitask 并发解析、building 重任务态；"));
children.push(bul("M4：极简模式、原创角色主题包替换、换肤设置页。"));
children.push(h2("10.3 与主方案的衔接"));
children.push(bul("本文档对应主方案 5.1 节，可作为其展开附录；"));
children.push(bul("awaiting 状态强依赖主方案第六章「权限与安全设计」，二者需联调；"));
children.push(bul("状态触发源依赖主方案 5.2「Agent 引擎」对外发出标准化生命周期事件。"));

children.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "—— 文档结束 ——", italics: true, color: "808080" })] }));

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: "2E5C8A" },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: "1F4E79" },
        paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, font: FONT, color: "333333" },
        paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{ reference: "bullets", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 460, hanging: 280 } } } },
    ] }],
  },
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "DeskPet — 桌宠动画引擎与状态机 细化设计", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("written:", process.argv[2]); });
