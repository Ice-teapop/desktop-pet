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
function callout(title, body, color) {
  color = color || "C9A227"; const bg = color === "C0392B" ? "FBEAE8" : "FBF6E3"; const tc = color === "C0392B" ? "9B2C1F" : "8A6D00";
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 6, color }, bottom: { style: BorderStyle.SINGLE, size: 6, color }, left: { style: BorderStyle.SINGLE, size: 18, color }, right: { style: BorderStyle.SINGLE, size: 1, color } },
      margins: { top: 120, bottom: 120, left: 200, right: 160 },
      shading: { fill: bg, type: ShadingType.CLEAR }, width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, bold: true, color: tc })] }),
        ...body.map((b) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: b, size: 20 })] })),
      ],
    })] })],
  });
}
function cell(text, opts = {}) {
  return new TableCell({
    borders, margins: cellMargins, width: { size: opts.w, type: WidthType.DXA },
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

children.push(
  new Paragraph({ spacing: { before: 2000, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "桌宠文件物理交互", bold: true, size: 48, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 },
    children: [new TextRun({ text: "与 用户状态识别", bold: true, size: 48, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "细化设计文档", bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 },
    children: [new TextRun({ text: "智能桌宠助手 DeskPet — 子模块设计", size: 24, color: "595959" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "桌宠文件物理交互与用户状态识别 — 细化设计"],
  ["所属方案", "智能桌宠助手 DeskPet 完整方案设计文档"],
  ["版本", "v1.0"],
  ["日期", "2026-05-15"],
  ["涵盖内容", "① 桌宠与桌面文件的物理交互；② 用户状态识别（用于驱动动画）"],
  ["用户状态识别维度", "活跃/空闲/离开 · 当前应用 · 当前文件夹 · 专注/勿扰"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1
children.push(h1("一、概述"));
children.push(p("本文档细化两块设计：一是「桌宠与桌面文件的物理交互」—— 用户可以把文件拖到桌宠身上让它干活，桌宠也能把文件递出来；二是「用户状态识别」—— 桌宠感知用户此刻在干什么，并据此驱动动画表现。"));
children.push(p("两块共同的设计原则：物理交互只是「触发方式」，真正的文件操作仍走主方案第六章的安全网关；状态识别全部本地完成、可逐项开关、绝不上云。"));

// 2
children.push(h1("二、桌宠与桌面文件的物理交互"));
children.push(h2("2.1 交互总览"));
children.push(p("桌宠是一个透明的 Electron 窗口，它本身可以作为系统级的拖放目标（drop target），也可以作为拖放来源（drag source）。整体交互分两个方向："));
children.push(table([2200, 7160], ["方向", "说明"], [
  ["拖入：文件 → 桌宠", "用户从访达 / 资源管理器 / 桌面把文件或文件夹拖到桌宠身上，桌宠「接住」并弹出操作菜单"],
  ["拖出：桌宠 → 外部", "桌宠把它正持有的文件（如刚处理完、整理出的结果）递回给用户，可拖到任意文件夹窗口"],
]));
children.push(h2("2.2 拖入：文件 → 桌宠"));
children.push(h3("2.2.1 按拖入内容分类"));
children.push(table([2000, 2400, 4960], ["拖入内容", "桌宠反应", "弹出的操作菜单（示例）"], [
  ["单个文件", "张手期待 → 接住抱住", "打开 / 移动到… / 重命名 / 分析内容 / 删除到回收站"],
  ["多个文件", "抱一摞", "批量重命名 / 按类型归类 / 批量移动 / 打包 / 批量删除"],
  ["文件夹", "抱住文件夹", "整理这个文件夹 / 分析里面有什么 / 找重复文件 / 移动"],
  ["图片 / 文档等特定类型", "同上 + 类型识别", "在通用菜单基础上追加类型相关操作（如图片：压缩 / 转格式）"],
]));
children.push(h3("2.2.2 拖入的视觉反馈序列"));
children.push(p("拖入过程中桌宠给出连续的视觉反馈，让用户清楚「能不能放、放了会怎样」："));
children.push(table([2400, 2400, 4560], ["阶段", "桌宠状态", "说明"], [
  ["文件被拖起、靠近桌宠", "expecting 期待", "桌宠张开手 / 抬头，提示「可以放这里」"],
  ["悬停在桌宠本体上方", "expecting + 高亮", "桌宠本体描边高亮，确认这是有效落点"],
  ["松手放下（drop 命中）", "catch 接住（一次性）", "桌宠把文件抱住的短动画"],
  ["菜单弹出、等用户选", "holding 持有", "桌宠抱着文件等待，对应主方案 awaiting 类表现"],
  ["用户选定操作并通过确认", "moving / working / organizing", "进入对应任务状态（见动画状态机文档）"],
  ["操作完成", "success 完成", "放下文件 + 开心动画"],
]));
children.push(h2("2.3 拖出：桌宠 → 外部"));
children.push(bul("桌宠完成整理 / 转换后产生的结果文件，会显示为它「手里拿着」的小图标；"));
children.push(bul("用户可以从桌宠身上把这些文件拖到任意访达窗口 / 桌面，完成「取走」；"));
children.push(bul("也支持「右键桌宠 → 最近成果」列表，逐个拖出或一次性放到指定目录；"));
children.push(bul("技术上用 Electron 的 webContents.startDrag() 发起原生拖出。"));
children.push(h2("2.4 落点检测：只有本体可接收"));
children.push(bul("桌宠窗口大部分是透明的，必须保证只有「角色实体像素」是有效落点，透明区域不接收；"));
children.push(bul("做法：拖拽悬停时对鼠标坐标做像素级命中检测（与点击穿透同一套逻辑）；"));
children.push(bul("命中本体才显示 expecting + 高亮，否则视为穿透、不接收 drop；"));
children.push(bul("极简模式下桌宠只露半身，落点区域相应缩小为可见部分。"));
children.push(h2("2.5 与安全网关的关系（重要）"));
children.push(callout("物理交互只是「触发器」，不是「免确认通道」", [
  "把文件拖到桌宠身上，只代表用户选择了「操作对象」，不代表用户已经授权了「操作本身」。",
  "拖入后弹出的菜单里，凡是 L2/L3 敏感操作（移动 / 删除 / 批量改名 / 跑命令），选中后仍然要走主方案第六章的确认卡片，桌宠进入 awaiting 状态等用户点「允许 / 拒绝」。",
  "删除一律进回收站、批量操作先给变更预览清单 —— 这些规则在物理交互路径下同样生效，不能因为「拖进来很方便」就跳过。",
]));
children.push(h2("2.6 技术实现要点"));
children.push(bul("拖入：渲染进程监听 DOM 的 dragover / drop 事件，dragover 里 preventDefault 才能接收；drop 事件的 e.dataTransfer.files 可拿到文件对象，其 path 属性即真实路径；"));
children.push(bul("路径拿到后通过 IPC 交给主进程，由文件操作模块 + 安全网关处理，渲染进程不直接碰文件系统；"));
children.push(bul("拖出：webContents.startDrag({ file, icon }) 发起原生拖出；"));
children.push(bul("命中检测：复用窗口外壳的「像素级命中 + setIgnoreMouseEvents 动态切换」逻辑；"));
children.push(bul("跨平台差异（访达 vs 资源管理器的拖放行为）封装在统一适配层。"));

// 3
children.push(h1("三、用户状态识别"));
children.push(p("桌宠需要感知「用户此刻在干什么」，据此驱动动画。按需求确认，识别四个维度。"));
children.push(h2("3.1 识别维度总览"));
children.push(table([1900, 2400, 2600, 2460], ["维度", "识别内容", "数据来源", "可靠性"], [
  ["活动状态", "活跃 / 空闲 / 离开 / 锁屏", "Electron powerMonitor", "高"],
  ["当前应用", "前台 App 名称、窗口标题", "active-win 等原生查询", "中（macOS 需授权）"],
  ["当前文件夹", "当前操作的文件 / 目录路径", "前台窗口标题解析 + 最近文件", "低（尽力而为）"],
  ["专注状态", "全屏 / 勿扰 / 演示中", "全屏检测 + 系统勿扰状态", "中"],
]));
children.push(h2("3.2 活跃 / 空闲 / 离开 / 锁屏"));
children.push(bul("用 Electron powerMonitor.getSystemIdleState(threshold) / getSystemIdleTime() 获取系统空闲时长；"));
children.push(bul("监听 powerMonitor 的 lock-screen / unlock-screen / suspend / resume 事件；"));
children.push(bul("分级阈值（可在设置中调整）："));
children.push(table([2000, 2200, 5160], ["状态", "判定条件", "典型动画"], [
  ["active 活跃", "近期有键鼠输入", "idle 待机（呼吸、眼球追踪）"],
  ["idle 空闲", "无输入 ≥ 60 秒", "进入睡眠序列（打哈欠 → 打盹）"],
  ["away 离开", "无输入 ≥ 5 分钟", "深睡"],
  ["locked 锁屏 / 休眠", "lock-screen / suspend 事件", "深睡（并暂停高耗动画）"],
]));
children.push(h2("3.3 当前所在的应用程序"));
children.push(bul("Electron 没有内置的跨平台「前台 App」查询，需借助 active-win 这类库或自带的原生小助手；"));
children.push(bul("可拿到：前台 App 名称、窗口标题，部分平台还能拿到文档路径；"));
children.push(bul("macOS 上获取窗口标题可能需要「屏幕录制」权限，首次使用要引导用户授权，未授权则降级为只识别 App 名；"));
children.push(bul("轮询频率不必高（如每 2–3 秒一次），降低开销。"));
children.push(h2("3.4 当前操作的文件 / 文件夹"));
children.push(bul("这是四个维度里最「尽力而为」的一项，不保证 100% 准确；"));
children.push(bul("来源一：解析前台窗口标题（很多 App 的标题里带文件名 / 路径）；"));
children.push(bul("来源二：访达 / 资源管理器在前台时，可获取其当前目录；"));
children.push(bul("来源三：系统「最近打开」列表作为补充；"));
children.push(bul("识别不到时就标记为 unknown，不猜测、不报错。"));
children.push(h2("3.5 专注 / 勿扰 / 全屏"));
children.push(bul("全屏检测：前台窗口是否占满整个屏幕（看作演示 / 沉浸场景）；"));
children.push(bul("系统勿扰 / 专注模式：尽力读取系统勿扰状态，读不到则用「全屏 + 长时间无切换」作近似判断；"));
children.push(bul("命中专注状态 → 桌宠自动进入极简模式（见 4.3）。"));
children.push(h2("3.6 隐私与权限"));
children.push(callout("用户状态识别 = 在「观察用户」，必须克制且透明", [
  "识别「当前 App / 当前文件」本质上是在观察用户的使用行为，是敏感能力，设计上必须满足：",
  "① 全部本地处理：所有识别只在本机进行，绝不上传，也不发给云端模型（除非用户为某次对话显式授权）；",
  "② 逐项开关：四个维度各自可在设置里独立关闭，关闭后桌宠退化为只看「活跃/空闲」；",
  "③ 应用黑名单：默认对密码管理器、银行、隐私浏览窗口等不做任何识别；",
  "④ 可见可查：设置里能看到「桌宠当前识别到什么」，让用户随时知道它在感知什么；",
  "⑤ 最小留存：状态识别结果只用于即时驱动动画，不写入长期日志。",
], "C0392B"));

// 4
children.push(h1("四、用户状态 → 驱动动画"));
children.push(p("按需求确认，识别用户状态目前只用于一个目的：驱动桌宠动画，不做主动打扰、暂不喂给 Agent。"));
children.push(h2("4.1 状态 → 动画映射"));
children.push(table([2400, 2600, 4360], ["用户状态", "桌宠动画表现", "说明"], [
  ["active 活跃", "idle 待机 + 眼球追踪", "正常陪伴态"],
  ["idle 空闲（≥60s）", "睡眠序列：打哈欠 → 打盹", "渐进式，不突兀"],
  ["away 离开（≥5min）/ locked 锁屏", "深睡 + 暂停高耗动画", "省资源"],
  ["从空闲/睡眠恢复输入", "惊醒弹起 → 回 idle", "复用动画状态机的惊醒动画"],
  ["前台 = 文件管理器", "idle 的「精神」变体（抬头、留意）", "轻微表现，暗示「我在这儿、随时能帮忙」"],
  ["前台 = 其它 App", "普通 idle", "不打扰"],
  ["当前文件夹已识别", "（暂仅作记录）", "本期不直接驱动动画，预留给将来"],
  ["专注 / 全屏 / 勿扰", "自动进入极简模式", "见 4.3"],
]));
children.push(callout("关于「当前应用 / 当前文件夹」对动画的影响", [
  "你选择了识别这两个维度，但用途限定为「驱动动画」。需要说明：这两个维度对动画的可发挥空间其实较小 —— 目前只建议做「前台是文件管理器时桌宠表现得更精神一点」这种轻量暗示，避免桌宠频繁变脸造成干扰。",
  "「当前文件夹」这一维度本期建议只做识别与记录、暂不驱动动画。它真正的价值是「给 Agent 提供上下文」（让桌宠知道你在哪个目录、操作更准）—— 如果之后想用上，可以低成本扩展，识别能力现在就先建好。",
]));
children.push(h2("4.2 与任务状态机的关系"));
children.push(p("用户状态是喂给动画状态机的「另一路输入」，与「任务状态」并行。两者按优先级合并："));
children.push(bul("任务状态优先：只要桌宠自己有任务在跑（working / moving / awaiting…），就显示任务状态，哪怕用户已离开 —— 这样用户回来能立刻看到进度；"));
children.push(bul("用户状态兜底：没有任何活跃任务时，才由用户状态决定显示 idle / 睡眠 / 深睡；"));
children.push(bul("对应动画状态机文档 5.1 的优先级表：用户状态驱动的 idle / sleep 处于最低优先级（第 7 级）。"));
children.push(h2("4.3 自动极简模式"));
children.push(bul("识别到专注 / 全屏 / 勿扰 → 桌宠自动切到极简模式，藏到屏幕边缘；"));
children.push(bul("退出专注状态 → 自动恢复正常模式（抛物线跳回）；"));
children.push(bul("即使在极简模式，awaiting 等待确认 / error 报错 这类安全相关提醒仍会探头提示（见动画状态机文档第九章）；"));
children.push(bul("用户可在设置里关闭「自动极简」，改为始终手动控制。"));

// 5
children.push(h1("五、技术实现要点与依赖"));
children.push(table([2800, 6560], ["能力", "实现方式 / 依赖"], [
  ["文件拖入", "渲染进程 DOM dragover/drop 事件，e.dataTransfer.files[].path"],
  ["文件拖出", "Electron webContents.startDrag()"],
  ["落点像素命中", "复用窗口外壳的命中检测 + setIgnoreMouseEvents 动态切换"],
  ["活跃/空闲/锁屏", "Electron powerMonitor（内置，无需额外依赖）"],
  ["前台 App / 窗口标题", "active-win 库或自带原生助手；macOS 可能需屏幕录制权限"],
  ["当前文件夹", "窗口标题解析 + 文件管理器查询 + 系统最近文件（尽力而为）"],
  ["全屏 / 勿扰", "前台窗口尺寸判断 + 系统勿扰状态读取（尽力而为）"],
  ["状态汇聚", "主进程内「用户状态采集器」定时轮询，与 Agent 任务事件一起喂给动画状态机"],
]));
children.push(h2("5.1 采集器结构（伪代码）"));
children.push(code("class UserStateCollector {"));
children.push(code("  // 每 2~3s 轮询一次，结果只在内存里，不落盘"));
children.push(code("  poll() {"));
children.push(code("    const activity = powerMonitor.getSystemIdleState(60)  // active/idle/locked"));
children.push(code("    const front    = settings.detectApp    ? getActiveWindow() : null"));
children.push(code("    const focus    = settings.detectFocus  ? detectFullscreenOrDND() : null"));
children.push(code("    if (isBlacklisted(front?.app)) front = null   // 黑名单 App 不识别"));
children.push(code("    bus.emit('user.state', { activity, front, focus })"));
children.push(code("  }"));
children.push(code("}"));

// 6
children.push(h1("六、待办与衔接"));
children.push(bul("M2：实现文件拖入 + 落点像素命中 + 拖入后接入安全网关确认流程；"));
children.push(bul("M2：实现 powerMonitor 活跃/空闲/离开/锁屏识别，驱动睡眠与惊醒动画；"));
children.push(bul("M3：实现文件拖出（startDrag）+「最近成果」列表；"));
children.push(bul("M3：接入 active-win 做前台 App 识别，补「文件管理器精神变体」表现；"));
children.push(bul("M3：全屏/勿扰检测 + 自动极简模式；"));
children.push(bul("M4：当前文件夹识别（先做识别与记录，为将来喂给 Agent 预留）；"));
children.push(bul("M2：隐私设置页 —— 四维度独立开关、应用黑名单、当前识别结果可视化。"));
children.push(h2("6.1 与其它文档的衔接"));
children.push(bul("物理交互的 expecting / catch / holding 表现，需登记进《桌宠动画引擎与状态机》的状态清单；"));
children.push(bul("拖入后的敏感操作确认，强依赖主方案第六章《权限与安全设计》；"));
children.push(bul("用户状态作为动画状态机的「第二路输入」，需在 Agent 引擎事件总线之外单独接入采集器。"));

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
  numbering: { config: [{ reference: "bullets", levels: [
    { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 460, hanging: 280 } } } },
  ] }] },
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "DeskPet — 文件物理交互与用户状态识别 细化设计", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("written:", process.argv[2]); });
