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
  color = color || "C9A227"; const bg = color === "C0392B" ? "FBEAE8" : (color === "2E7D5B" ? "E6F4EE" : "FBF6E3");
  const tc = color === "C0392B" ? "9B2C1F" : (color === "2E7D5B" ? "1E5C42" : "8A6D00");
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
  new Paragraph({ spacing: { before: 2200, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "桌宠视觉功能", bold: true, size: 52, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "细化设计文档", bold: true, size: 34 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "智能桌宠助手 DeskPet — 子模块设计", size: 24, color: "595959" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 },
    children: [new TextRun({ text: "v2：架构调整为「瘦客户端 + 自托管视觉服务」", size: 20, color: "9B2C1F" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "桌宠视觉功能 — 细化设计"],
  ["所属方案", "智能桌宠助手 DeskPet 完整方案设计文档"],
  ["版本", "v2（架构调整版）"],
  ["日期", "2026-05-15"],
  ["系统架构", "瘦客户端（桌宠）+ 自托管视觉服务（用户自己的服务器）"],
  ["工作方式", "用户划定区域 → 桌宠盯守 → 帧发往你的服务器提取信息 → 用户问、AI 答"],
  ["视觉模型位置", "非 LLM 的视觉模型部署在用户自有服务器，不打包进客户端"],
  ["LLM 方案", "第三方 LLM API，由用户自行填写 API Key（BYOK），成本与选型由用户掌控"],
  ["AI 介入程度", "用户完全自主问答，AI 不主动干预、不代为操作界面"],
  ["留存策略", "默认不留存（客户端、服务器均不存）；需保留时桌宠主动询问"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 0 修订说明
children.push(h1("修订说明（v1 → v2）"));
children.push(p("v1 假设视觉模型默认跑在用户本机（「默认本地，复杂时上云」）。根据需求确认，用户拥有自己的服务器，希望把「非 LLM 的视觉模型」部署在自有服务器上，让桌宠客户端保持轻量。v2 据此把架构调整为「瘦客户端 + 自托管视觉服务」，并固化了 LLM 方案与 AI 介入程度两项决策。"));
children.push(table([3000, 3180, 3180], ["方面", "v1", "v2（本版）"], [
  ["视觉模型位置", "打包进客户端，本机运行", "部署在用户自有服务器"],
  ["客户端体量", "需内置视觉模型，较重", "只做截图 / 变化检测 / 通信，很轻"],
  ["画面去向", "默认不出本机", "发往用户自己的服务器（不经第三方）"],
  ["分层逻辑", "本地模型 →（复杂）云端 LLM", "你的视觉服务提信息 →（复杂推理）LLM"],
  ["LLM 方案", "（未定）", "第三方 LLM API，用户自填 API Key（BYOK），成本可控"],
  ["AI 介入程度", "（未定，含可选代操作）", "用户完全自主问答，AI 不干预、不代操作界面"],
]));

// 1
children.push(h1("一、概述与设计目标"));
children.push(p("视觉功能让桌宠能「看懂」屏幕上用户划定区域的内容，从而无感、无障碍地直接回答问题、协助工作 —— 用户不必再手动截图、复制、粘贴。用户的核心诉求是「拿到信息」：把区域画面提取成可用的结构化信息。"));
children.push(p("它和已设计的「用户状态识别」是两件事：状态识别只知道你在用哪个 App、是否空闲；视觉功能则真正读懂区域里的画面内容（文字、报错、表格、界面元素等）。"));
children.push(h2("1.1 三条设计铁律"));
children.push(callout("视觉功能的三条铁律（v2）", [
  "① 区域限定：桌宠只看用户亲手划定的区域，绝不看整个屏幕。区域本身就是最强的隐私边界。",
  "② 自托管 + BYOK：视觉信息提取走用户自己的服务器；LLM 推理走用户自己填入的第三方 API Key —— 数据路径与成本都在用户手里。",
  "③ 默认不留存：区域画面默认即用即弃 —— 客户端、用户服务器两侧都不落盘；只有桌宠主动询问、用户明确同意，才保留。",
]));
children.push(h2("1.2 「无感无障碍」与「轻量」"));
children.push(bul("无感：划定区域是一次性设置，之后桌宠自动盯守，用户无需反复截图 / 复制 / 粘贴；"));
children.push(bul("无障碍：桌宠永不抢焦点、不遮挡，观察与回答都在它自己的气泡里完成，不打断你手上的事；"));
children.push(bul("轻量：视觉模型不打包进客户端，客户端只负责截图、变化检测、与服务器通信，安装包小、内存占用低；"));
children.push(bul("边界：「无感」不等于「偷偷看」—— 桌宠观察时必须有明确的可见指示（见第七章）。"));

// 2 架构
children.push(h1("二、系统架构：瘦客户端 + 自托管视觉服务"));
children.push(h2("2.1 为什么这样分"));
children.push(bul("客户端轻：把「非 LLM 的视觉模型」这类体量大的组件放到服务器，桌宠客户端就能保持小巧；"));
children.push(bul("可控：画面只发往用户自己的服务器，数据始终在用户掌控的基础设施内，不经第三方；"));
children.push(bul("易升级：视觉模型在服务器端，换模型 / 调参不需要让用户更新客户端。"));
children.push(h2("2.2 三方角色与职责"));
children.push(table([2200, 3000, 4160], ["角色", "在哪", "职责"], [
  ["桌宠客户端", "用户电脑（瘦客户端）", "区域框选、按区域截图、变化检测、加密上传、接收结果并展示 / 交给 Agent。不内置视觉模型。"],
  ["自托管视觉服务", "用户自己的服务器", "部署非 LLM 的视觉模型（OCR / 版面检测 / 元素识别等），接收帧 → 提取结构化信息 → 返回。处理完即丢，不留存。"],
  ["LLM（Agent 大脑）", "第三方 LLM API", "拿到视觉服务返回的结构化信息后做推理、生成回答。由用户自行填写 API Key（BYOK），调用产生的费用走用户自己的账号。"],
]));
children.push(callout("LLM 方案：BYOK（Bring Your Own Key）", [
  "Agent 用的 LLM 采用第三方 API，但由用户在设置里自行填写 API Key —— 这样 LLM 的费用走用户自己的账号，产品方不代付、成本完全可控；用户也能自由选择模型供应商。",
  "首次使用视觉问答前，桌宠引导用户填写 API Key；未配置则视觉问答功能不可用（区域提取信息仍可工作，只是不经 LLM 做解释）。",
  "API Key 属敏感信息，存入操作系统钥匙串 / 加密存储，绝不明文落盘、绝不上传到任何服务器（包括用户自己的视觉服务器）。",
]));
children.push(h2("2.3 数据流"));
children.push(code("用户划定区域"));
children.push(code("  → 客户端按区域截图（只截矩形，不截全屏）"));
children.push(code("  → 客户端做变化检测（无变化则丢弃，不上传）"));
children.push(code("  → 加密上传「有变化的帧」到【你的服务器】"));
children.push(code("  → 服务器：非 LLM 视觉模型提取结构化信息（文字 / 报错 / 表格 / 元素）"));
children.push(code("  → 服务器处理完即丢弃该帧，返回结构化结果"));
children.push(code("  → 客户端 / Agent 拿到结构化信息（作为「随时备好的上下文」）"));
children.push(code("  → 用户主动提问 → 用结构化信息回答；需推理 → 第三方 LLM（用户自填 Key）"));
children.push(code("  → 回答显示在桌宠气泡；默认不留存，值得留 → 桌宠询问"));

// 3
children.push(h1("三、工作方式：区域划定 + 盯守"));
children.push(h2("3.1 划定观察区域"));
children.push(bul("用户通过「右键桌宠 → 划定观察区域」或快捷键，进入框选模式；"));
children.push(bul("屏幕浮现半透明遮罩，用户拖拽出一个矩形区域（如某个报错窗口、某段代码、某张表格）；"));
children.push(bul("一期支持 1 个活跃观察区域，位置 / 大小可随时调整或重新框选；"));
children.push(bul("区域信息（坐标 + 尺寸）只存在客户端内存，不写入磁盘。"));
children.push(h2("3.2 盯守模式"));
children.push(p("区域划定后，桌宠进入「盯守」：周期性捕获该区域画面，通过「变化检测」避免无谓上传。"));
children.push(p("注意：盯守只是为了「随时备好上下文」，让用户一问就能立刻答上。桌宠看到内容后不会主动开口、不会主动提建议 —— 它安静地看着，只有用户主动提问才回答（见第六章）。"));
children.push(table([2600, 6760], ["机制", "说明"], [
  ["周期捕获", "按较低频率（如每 1–2 秒）捕获一次区域画面，仅截该矩形"],
  ["变化检测（客户端）", "用帧差 / 感知哈希判断内容是否变化；没变化就不上传，省带宽、省隐私、省服务器算力"],
  ["内容稳定才上传", "内容变化后稳定一小段时间（如 0.5 秒）再上传，避免滚动 / 输入中途的画面"],
  ["桌宠表现", "盯守期间显示明确的「观察中」动画（见第七章 / 与动画状态机衔接）"],
]));
children.push(h2("3.3 暂停与退出"));
children.push(bul("「暂停盯守」：保留区域设置，但停止捕获与上传（适合临时离开 / 处理敏感内容）；"));
children.push(bul("「取消观察」：清除区域，完全退出视觉功能；"));
children.push(bul("识别到用户进入专注 / 全屏 / 勿扰（见用户状态识别文档）时，可配置为自动暂停盯守。"));

// 4
children.push(h1("四、视觉理解流程"));
children.push(h2("4.1 信息提取在你的服务器完成"));
children.push(bul("客户端只把「有变化、已稳定」的帧加密上传到用户自有服务器；"));
children.push(bul("服务器上的非 LLM 视觉模型负责把画面变成结构化信息：纯文本（OCR）、报错文本、表格数据、界面元素及其位置等；"));
children.push(bul("服务器处理完该帧即销毁，只回传结构化结果，不回传 / 不保存原图。"));
children.push(h2("4.2 何时需要 LLM"));
children.push(bul("视觉服务给出的是「客观信息」（屏幕上有什么）；要「理解 / 解释」则需要 LLM；"));
children.push(bul("简单场景（如「读出这段文字」「这张表第三列的值」）可不经 LLM，直接用结构化结果回答 —— 这部分即使用户没填 API Key 也能用；"));
children.push(bul("复杂场景（如「这个报错为什么会发生」）才把结构化信息交给第三方 LLM 推理，用的是用户自己填的 API Key；"));
children.push(bul("发送给第三方 LLM 的是「提取后的结构化信息 / 文字」，而非原始截图；首次使用时告知用户「问答会调用你配置的 LLM、产生你账号的费用」，之后不再逐次打扰。"));
children.push(h2("4.3 为什么用「变化驱动」"));
children.push(bul("省带宽 / 省服务器算力：区域没变就不上传、不分析；"));
children.push(bul("省隐私：不变化 = 不上传，画面离开本机的次数降到最低；"));
children.push(bul("更准：只在内容稳定后上传，避免把滚动 / 打字中途的画面当成最终内容。"));

// 5
children.push(h1("五、数据留存策略"));
children.push(p("用户最关心、也最需要严格的一环。原则：默认即用即弃，客户端与服务器两侧都不留存；保留必须经桌宠主动询问 + 用户明确同意。"));
children.push(h2("5.1 默认不留存（两侧都不存）"));
children.push(bul("客户端：捕获的帧只在内存中存在，上传后即销毁，绝不落盘；"));
children.push(bul("服务器：视觉服务收到帧 → 提取信息 → 立即销毁原帧，不写日志、不存图；"));
children.push(bul("桌宠气泡里的回答，关闭气泡后不自动进历史，除非用户操作保留。"));
children.push(h2("5.2 需要保留时，桌宠主动询问"));
children.push(bul("桌宠判断「这条信息可能值得留」时，不擅自保存，而是弹出询问：「这条信息要保留吗？」并说明保留的是什么；"));
children.push(bul("用户可选：保留 / 不保留 / 保留但脱敏；"));
children.push(bul("用户不回应 = 默认不保留，自动丢弃，绝不「沉默即同意」。"));
children.push(h2("5.3 保留的内容形态"));
children.push(callout("保留「文字 / 结构化信息」，不保留「原始截图」", [
  "即使用户同意保留，默认保留的也是提取出的文字 / 结构化数据，而不是原始屏幕截图。",
  "原始截图只有在用户明确要求「连图一起存」时才保留，且会清楚标注、并明确存在哪（本机还是你的服务器）。",
], "2E7D5B"));
children.push(h2("5.4 黑名单与敏感内容"));
children.push(bul("默认敏感区域 / 应用黑名单：密码管理器、银行 / 支付页面、隐私浏览窗口等，桌宠拒绝在其上划定观察区域；"));
children.push(bul("盯守过程中若区域内出现疑似敏感内容（密码框、证件号、银行卡号等模式），桌宠自动暂停上传并提示用户；"));
children.push(bul("敏感内容检测尽量在客户端先做一道粗筛，命中即不上传；"));
children.push(bul("黑名单可由用户增删，但「敏感内容自动暂停」总开关不能关闭。"));

// 6
children.push(h1("六、能力边界：用户自主问答，AI 不做干预"));
children.push(p("视觉功能的定位很明确：用户完全自主问答，AI 不做任何干预。桌宠盯守区域只是为了「随时备好上下文」，它安静地看，只在用户主动提问时才作答。"));
children.push(h2("6.1 用户自主问答（核心诉求）"));
children.push(bul("用户对着划定区域提问：「这个报错什么意思」「这段代码哪里有问题」「这张表里哪个数最大」；"));
children.push(bul("桌宠结合区域提取出的信息直接作答，无需用户复制粘贴 —— 这就是用户要的「拿到信息」；"));
children.push(bul("问答完全由用户发起、按用户的节奏进行，桌宠不抢话、不催促。"));
children.push(h2("6.2 AI 不做任何干预"));
children.push(callout("「AI 不干预」具体意味着", [
  "看到内容不主动开口：哪怕区域里出现了明显的报错，桌宠也不会主动弹出「要帮忙吗」，只是默默把上下文备好，等用户问。",
  "不基于看到的内容代为操作：桌宠不会照着屏幕去点按钮、填表单、改文件 —— 视觉功能是「只读」的，纯粹用来回答问题。",
  "不主动提建议、不打分、不评判：用户问什么答什么，不主动延伸、不主动指点。",
  "一句话：视觉 = 用户的「眼睛延伸 + 问答助手」，不是会自己动手的代理。",
]));
children.push(h2("6.3 桌宠不做什么"));
children.push(bul("不看用户未划定的区域，不截全屏；不在用户不知情时观察；"));
children.push(bul("不主动开口、不代为操作界面、不擅自延伸（见 6.2）；"));
children.push(bul("不把画面发往第三方；提取后的信息只在用户提问时才发往用户自配的第三方 LLM；"));
children.push(bul("不擅自留存；不在敏感页面上工作。"));

// 7
children.push(h1("七、隐私与安全设计"));
children.push(callout("视觉功能 = 让桌宠「能看」，必须让用户「全程知情、随时可控」", [
  "① 可见指示器：只要桌宠在盯守，就显示明确的「观察中」动画，并在观察区域边缘显示一圈柔和高亮描边 —— 用户一眼知道「它在看哪里、正在看」。",
  "② 区域即边界：桌宠能力上就只能拿到划定区域的画面，做不到「想看别处」。",
  "③ 传输加密：客户端到你的服务器全程 TLS 加密；服务器地址、凭证由用户在设置中配置。",
  "④ 两侧不留存：客户端、服务器都默认不落盘；服务器端实现需明确「收到即提取、提取即销毁」。",
  "⑤ LLM 透明可控：用户自填 API Key（BYOK），费用走用户账号；首次使用告知「问答会调用你配置的 LLM」；发往 LLM 的是提取后的文字信息而非原始截图。API Key 加密存储、绝不上传。",
  "⑥ 留存可查可删：被保留的信息能在设置里查看、逐条删除、一键清空。",
  "⑦ 一键全停：提供「暂停所有视觉功能」开关，以及取消观察区域的快捷操作。",
], "C0392B"));

// 8
children.push(h1("八、与其它模块的关系"));
children.push(table([2600, 6760], ["相关模块", "关系"], [
  ["用户状态识别", "两者互补但不混用：状态识别知道「你在哪个 App / 是否空闲」，视觉功能读懂「区域里是什么内容」。视觉帧不参与状态识别。"],
  ["动画状态机", "新增「watching 观察中」状态：盯守期间显示，优先级低于任务态、高于普通 idle；需登记进动画状态机文档的状态清单。"],
  ["Agent 引擎", "视觉作为 Agent 的「感知工具」：Agent 可调用「读取当前观察区域信息」，背后是「客户端取帧 → 你的服务器提取 → 返回结构化信息」。"],
  ["安全网关", "视觉只提供上下文；由此引发的写操作 / 命令 / 代操作仍走安全网关确认。"],
  ["主方案 5.2 Agent 引擎", "「读取观察区域」需在工具注册表登记；服务器地址 / LLM 位置等配置纳入主方案配置模块。"],
]));

// 9
children.push(h1("九、技术实现要点"));
children.push(h2("9.1 客户端（瘦）"));
children.push(table([2800, 6560], ["能力", "实现方式 / 方向"], [
  ["区域框选", "全屏半透明遮罩窗口让用户拖拽矩形；区域坐标仅存内存"],
  ["区域截图", "Electron desktopCapturer 或原生截图能力，按矩形裁剪"],
  ["变化检测", "相邻帧帧差 / 感知哈希（pHash）比较，低于阈值视为无变化、不上传"],
  ["敏感粗筛", "客户端先做一道轻量敏感模式检测，命中即不上传"],
  ["上传通信", "TLS 加密，把有变化的帧发往用户配置的服务器地址；带重试与超时"],
  ["可见指示器", "桌宠 watching 动画 + 观察区域边缘高亮描边窗口"],
  ["不含", "不打包任何视觉模型，保持安装包小、内存占用低"],
]));
children.push(h2("9.2 服务器（你的）"));
children.push(table([2800, 6560], ["能力", "实现方式 / 方向"], [
  ["视觉服务接口", "提供一个接收帧、返回结构化信息的 HTTP/gRPC 接口（带鉴权）"],
  ["非 LLM 视觉模型", "部署 OCR / 版面检测 / 元素识别等模型，把画面变成文字 + 结构化数据"],
  ["不留存", "收到帧 → 提取 → 立即销毁原帧；不写图、不写含画面的日志"],
  ["鉴权", "客户端与服务器之间用 token / 证书鉴权，防止他人调用你的视觉服务"],
]));
children.push(h2("9.3 客户端视觉子系统结构（伪代码）"));
children.push(code("class VisionWatcher {              // 运行在客户端"));
children.push(code("  region = null                    // 仅内存"));
children.push(code("  lastHash = null"));
children.push(code(""));
children.push(code("  async tick() {                   // 每 1~2s"));
children.push(code("    if (!region || paused) return"));
children.push(code("    const frame = captureRegion(region)        // 只截矩形"));
children.push(code("    if (pHash(frame) === lastHash) return       // 无变化，不上传"));
children.push(code("    lastHash = pHash(frame)"));
children.push(code("    if (looksSensitive(frame)) return pauseAndWarn()  // 客户端粗筛"));
children.push(code("    const info = await visionService.extract(frame)   // 发往【你的服务器】"));
children.push(code("    frame.destroy()                             // 上传后即弃"));
children.push(code("    bus.emit('vision.context', info)            // 交给 Agent / 气泡"));
children.push(code("  }"));
children.push(code("}"));

// 10
children.push(h1("十、待办与衔接"));
children.push(bul("M3：区域框选 + 区域截图 + 变化检测 + 客户端敏感粗筛；"));
children.push(bul("M3：视觉服务接口约定 + 服务器端非 LLM 视觉模型部署（你的服务器）；"));
children.push(bul("M3：客户端↔服务器加密通信与鉴权；watching 动画 + 区域高亮指示器；"));
children.push(bul("M3：API Key 配置入口 + 加密存储；用户自主问答交互（用户问、AI 答）；"));
children.push(bul("M3：默认不留存 + 留存询问交互；"));
children.push(bul("M4：敏感内容自动暂停、应用黑名单；"));
children.push(bul("M4：留存内容查看 / 删除 / 清空设置页；视觉作为 Agent 感知工具的编排接入。"));
children.push(h2("10.1 与其它文档的衔接"));
children.push(bul("「watching 观察中」状态需补进《桌宠动画引擎与状态机》的状态清单与优先级表；"));
children.push(bul("留存询问、敏感暂停、API Key 管理需纳入主方案第六章《权限与安全设计》；"));
children.push(bul("视觉感知工具、服务器地址、LLM API Key 配置需在主方案 5.2 Agent 引擎与配置模块登记。"));
children.push(h2("10.2 已确认的关键决策"));
children.push(table([3000, 6360], ["决策点", "结论"], [
  ["视觉模型位置", "非 LLM 视觉模型部署在用户自有服务器；客户端瘦身、不打包模型"],
  ["LLM 方案", "第三方 LLM API，用户自填 API Key（BYOK）—— 费用走用户账号，产品方不代付，成本可控"],
  ["AI 介入程度", "用户完全自主问答，AI 不主动开口、不代为操作界面，视觉功能为「只读问答」"],
  ["留存策略", "客户端、服务器两侧默认均不留存；需保留时桌宠主动询问"],
]));

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
      children: [new TextRun({ text: "DeskPet — 桌宠视觉功能 细化设计 v2", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("written:", process.argv[2]); });
