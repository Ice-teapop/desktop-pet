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
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!opts.bold, color: opts.color, font: opts.mono ? "Consolas" : undefined, size: opts.mono ? 18 : undefined })], alignment: opts.align })],
  });
}
function table(colWidths, header, rows, monoColsIdx) {
  monoColsIdx = monoColsIdx || [];
  const total = colWidths.reduce((a, b) => a + b, 0);
  const headRow = new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, { w: colWidths[i], bold: true, fill: "2E5C8A", color: "FFFFFF" })) });
  const bodyRows = rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, { w: colWidths[i], fill: ri % 2 ? "F2F5F8" : "FFFFFF", mono: monoColsIdx.includes(i) })) }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: colWidths, rows: [headRow, ...bodyRows] });
}

const children = [];

children.push(
  new Paragraph({ spacing: { before: 2300, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "非 LLM 视觉服务", bold: true, size: 52, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "框架设计文档", bold: true, size: 34 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "智能桌宠助手 DeskPet — 自托管视觉服务子模块", size: 24, color: "595959" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 },
    children: [new TextRun({ text: "核心：把屏幕区域里的特殊符号与格式，自动转码成机器可理解的规范化表示", size: 20, color: "1E5C42" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "非 LLM 视觉服务 — 框架设计"],
  ["所属方案", "智能桌宠助手 DeskPet 完整方案设计文档"],
  ["版本", "v1.0（框架稿）"],
  ["日期", "2026-05-15"],
  ["部署位置", "用户自有服务器（不打包进桌宠客户端）"],
  ["核心职责", "区域画面 → 结构化表示；特殊符号 / 格式自动转码为机器语言（LaTeX、JSON、Markdown 等）"],
  ["定位", "纯感知 / 提取，不含 LLM 推理；输出供 Agent / LLM 使用"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1
children.push(h1("一、概述与定位"));
children.push(p("非 LLM 视觉服务是部署在用户自有服务器上的一个组件。桌宠客户端把用户划定区域的画面帧发过来，本服务负责把画面「看懂」并转成机器可理解的结构化表示，再返回给客户端 / Agent。它本身不含 LLM、不做推理，只做「感知与提取」。"));
children.push(p("本文档先打出整体框架：流水线分几段、每段干什么、模块怎么组织，重点展开「转码层」—— 即把特殊符号与格式自动转成机器语言的部分。"));
children.push(h2("1.1 为什么「转码」是核心"));
children.push(p("普通 OCR 只会把画面里的字「抄」出来，遇到分数、积分、表格、代码缩进、化学式、流程图这类「特殊符号与格式」就会丢失结构、抄乱、或抄成一串无意义字符。本服务的关键价值，是识别出这些特殊内容的「类型」，再把它转成对应的、机器能精确理解的规范化表示 —— 例如把一个分数画面转成 LaTeX，把一张表格转成结构化 JSON。"));
children.push(callout("「机器可理解的规范化表示」是什么意思", [
  "指有明确语法、可被程序无歧义解析的表示形式，而不是「看起来像那么回事」的纯文本。例如：",
  "数学公式 → LaTeX；表格 → 结构化 JSON；代码 → 保留缩进与转义的纯文本 + 语言标注；化学式 → SMILES。",
  "这样下游的 Agent / LLM 拿到的就是「结构」而不是「一团字」，回答才能准。",
]));
children.push(p("注：图表 / 流程图 / 示意图这类「需要看图理解」的内容，本服务不做转码，只把它标记成 chart 块、附上图像裁剪，交由下游的（多模态）LLM 去描述 —— 这是经确认的分工。"));
children.push(h2("1.2 设计目标"));
children.push(bul("准：特殊符号 / 格式不丢结构，转码结果可被程序解析；"));
children.push(bul("可扩展：新增一种「特殊格式」只需加一个识别器 + 一个转码器，不动主流程；"));
children.push(bul("轻接入：对客户端只暴露一个简单接口，输入帧、输出统一 schema 的结构化结果；"));
children.push(bul("守规矩：呼应视觉功能铁律 —— 收到即提取、提取即销毁，不留存原始帧。"));

// 2
children.push(h1("二、总体框架（处理流水线）"));
children.push(p("服务内部是一条八段流水线，一帧画面从进入到产出结构化结果，依次经过："));
children.push(code("[1] 接入层    收帧 / 鉴权 / 校验"));
children.push(code("      ↓"));
children.push(code("[2] 预处理    去噪 / 矫正 / DPI 归一化"));
children.push(code("      ↓"));
children.push(code("[3] 版面分析  切块：文本 / 表格 / 公式 / 代码 / 图表 / 符号"));
children.push(code("      ↓"));
children.push(code("[4] 区块分派  按块类型分发给对应识别器"));
children.push(code("      ↓"));
children.push(code("[5] 专项识别器（可插拔）  各类型各自识别 → 原始结果"));
children.push(code("      ↓"));
children.push(code("[6] 转码层    特殊符号 / 格式 → 机器语言（LaTeX / JSON / Markdown…）"));
children.push(code("      ↓"));
children.push(code("[7] 结构化合并  按阅读顺序拼成一份统一结构"));
children.push(code("      ↓"));
children.push(code("[8] 输出层    统一 schema 的 JSON 返回客户端"));
children.push(h2("2.1 八段概览"));
children.push(table([1500, 2200, 5660], ["阶段", "名称", "职责"], [
  ["1", "接入层 Ingest", "接收客户端帧、鉴权、格式与尺寸校验、限流"],
  ["2", "预处理 Preprocess", "去噪、对比度 / 二值化、倾斜矫正、DPI 与分辨率归一化"],
  ["3", "版面分析 Layout", "把区域切成语义区块，并给每块打上类型标签"],
  ["4", "区块分派 Dispatch", "按块类型路由到对应的专项识别器，可并行"],
  ["5", "专项识别器 Recognizers", "文本 / 表格 / 公式 / 代码 / 图表 / 符号等各自识别，产出原始结果"],
  ["6", "转码层 Transcoding", "把原始结果归一化为机器语言（本服务的核心，见第四章）"],
  ["7", "结构化合并 Assembly", "按阅读顺序合并各块，处理多栏 / 脚注 / 嵌套"],
  ["8", "输出层 Output", "组装统一 schema 的 JSON，附置信度，返回客户端"],
]));

// 3
children.push(h1("三、各阶段详细设计"));
children.push(h2("3.1 接入层 Ingest"));
children.push(bul("对外只暴露一个接口（HTTP / gRPC），输入：一帧图像 + 元数据（区域尺寸、来源等）；"));
children.push(bul("鉴权：与客户端之间用 token / 证书校验，防止他人盗用你的视觉服务；"));
children.push(bul("校验与限流：图像格式 / 尺寸校验，单客户端速率限制，防止异常占满服务器；"));
children.push(bul("收到帧后只在内存中流转，不写盘。"));
children.push(h2("3.2 预处理 Preprocess"));
children.push(bul("去噪、增强对比度，必要时二值化，提升后续识别准确率；"));
children.push(bul("倾斜 / 透视矫正（截图一般不歪，但留好这一步）；"));
children.push(bul("DPI 与分辨率归一化，让识别器面对统一尺度的输入。"));
children.push(h2("3.3 版面分析 Layout"));
children.push(p("这一步决定后面识别得准不准：把区域画面切成一个个语义区块，并给每块打类型标签。"));
children.push(bul("区块类型：普通文本、标题、表格、数学公式、代码块、图表 / 示意图、图片、孤立符号等；"));
children.push(bul("同时记录每块的位置坐标和在阅读顺序中的序号（供第七步合并用）；"));
children.push(bul("支持嵌套（如表格单元格里又有公式）。"));
children.push(h2("3.4 区块分派 Dispatch"));
children.push(bul("按块类型把每块路由到对应的专项识别器；"));
children.push(bul("chart 块（图表 / 流程图 / 示意图）走「直通」：不进识别器，只带上图像裁剪与坐标，留给下游 LLM 描述；"));
children.push(bul("不同块之间互相独立，可并行处理，缩短整帧延迟；"));
children.push(bul("没有匹配识别器的块 → 回退给通用文本 OCR，并标记「未专项处理」。"));
children.push(h2("3.5 专项识别器 Recognizers（可插拔）"));
children.push(p("每种内容类型对应一个识别器，全部遵循统一接口、可插拔（见第五章）。识别器覆盖范围："));
children.push(table([2000, 1400, 5960], ["识别器", "阶段", "负责"], [
  ["文本 OCR", "一期", "普通文字、标题、段落"],
  ["表格识别器", "一期", "识别行列结构、表头、合并单元格"],
  ["公式识别器", "一期", "数学 / 物理公式：分数、根号、积分、求和、矩阵、上下标"],
  ["代码识别器", "一期", "代码块：保留缩进、空白、特殊字符、转义；识别语言"],
  ["符号识别器", "二期", "孤立特殊符号：希腊字母、箭头、货币、单位、上下标、emoji"],
]));
children.push(callout("图表不在本服务识别范围内（经确认的分工）", [
  "图表 / 流程图 / 示意图这类需要「看图理解」的内容，本服务不设识别器、不做转码。",
  "版面分析仍会把它识别为一个 chart 块，但分派阶段走「直通（passthrough）」：只附上该块的图像裁剪与坐标，标记 type=chart，由下游的多模态 LLM 去描述。",
  "需注意：这意味着图表块的图像裁剪会随结果交给 LLM。若 LLM 是第三方，需与《桌宠视觉功能》文档的第三方 LLM 处理保持一致。",
]));
children.push(h2("3.6 转码层 Transcoding"));
children.push(p("本服务的核心，单独在第四章详细展开。各识别器产出的是「原始结果」，转码层负责把它归一化成机器语言。"));
children.push(h2("3.7 结构化合并 Assembly"));
children.push(bul("按版面分析记录的阅读顺序，把各块的转码结果拼成一份统一结构；"));
children.push(bul("处理多栏排版、脚注、页眉页脚的顺序重建；"));
children.push(bul("处理嵌套关系（表格里的公式、列表里的代码等）。"));
children.push(h2("3.8 输出层 Output"));
children.push(bul("组装成统一 schema 的 JSON（见第六章），每个块带类型、转码结果、置信度、坐标；"));
children.push(bul("返回客户端后，服务端立即销毁原始帧与中间产物。"));

// 4
children.push(h1("四、转码层详解（核心）"));
children.push(h2("4.1 设计思想"));
children.push(bul("识别与转码分离：识别器只管「认出来这是什么、内容是什么」，转码器只管「转成哪种机器语言」—— 两者解耦，便于各自替换；"));
children.push(bul("每种类型对应一个转码器，转码器也可插拔；"));
children.push(bul("转码目标尽量选「成熟、通用、可解析」的标准格式，不自创格式。"));
children.push(h2("4.2 特殊符号 / 格式 → 机器语言 映射表"));
children.push(p("这是转码层的核心配置 —— 各类特殊内容对应转成什么："));
children.push(table([1700, 2500, 2800, 2360],
  ["类型", "屏幕上的样子", "转码目标", "示例"],
  [
    ["数学公式", "分数、根号、积分、求和、矩阵、上下标", "LaTeX（已确认）", "∑ → \\sum；½ → \\frac{1}{2}"],
    ["表格", "带边框 / 对齐的网格", "结构化 JSON，行列+表头（已确认）", "{header:[...], rows:[[...]]}"],
    ["代码", "含缩进、空白、特殊字符、转义符", "纯文本（保留空白）+ 语言标注", "{lang:\"python\", text:\"...\"}"],
    ["化学式", "苯环、键线式、结构式", "SMILES / InChI", "苯 → c1ccccc1"],
    ["富文本格式", "粗体 / 斜体 / 标题层级 / 颜色", "Markdown 或语义标签", "**粗体**、# 标题"],
    ["特殊字符 / 符号", "希腊字母、箭头、货币、上下标", "规范化 Unicode + 语义标注", "α → U+03B1（greek alpha）"],
    ["报错信息", "终端 / IDE 里的报错", "结构化（类型 / 文件 / 行号 / 堆栈）", "{type, file, line, stack}"],
    ["单位与量纲", "5kg、3.5%、12:30", "规范化数值 + 单位字段", "{value:5, unit:\"kg\"}"],
    ["多栏 / 复杂排版", "多列、脚注、分栏", "重建阅读顺序后的线性结构", "ordered blocks"],
    ["图表 / 流程图", "节点 + 箭头 + 统计图", "不转码 —— 标记 chart 块、附图像裁剪，交 LLM 描述", "{type:\"chart\", crop:...}"],
  ], [3]));
children.push(h2("4.3 转码器接口"));
children.push(p("所有转码器实现同一个接口，便于注册与替换："));
children.push(code("interface Transcoder {"));
children.push(code("  type: string                 // 处理的块类型，如 'formula'"));
children.push(code("  target: string                // 目标格式，如 'latex'"));
children.push(code("  transcode(raw): {"));
children.push(code("    encoded: string | object,   // 机器语言表示"));
children.push(code("    target: string,             // 实际用的目标格式"));
children.push(code("    confidence: number          // 0~1"));
children.push(code("  }"));
children.push(code("}"));
children.push(h2("4.4 置信度与回退"));
children.push(bul("每个转码结果都带置信度；低于阈值时，标记为「低置信」并附上原始 OCR 文本作为兜底；"));
children.push(bul("识别不出类型 / 无对应转码器 → 回退为纯文本，明确标注「未转码」，绝不瞎转；"));
children.push(bul("宁可如实说「这块没把握」，也不要给下游一个看似正确实则错误的结构。"));

// 5
children.push(h1("五、可插拔识别器 / 转码器架构"));
children.push(bul("识别器注册表（Registry）：服务启动时按配置加载识别器与转码器，块类型 → 识别器 → 转码器形成一条链；"));
children.push(bul("新增一种特殊格式的成本：实现一个识别器 + 一个转码器，在注册表登记，主流水线零改动；"));
children.push(bul("识别器 / 转码器都可独立升级、替换、灰度，互不影响；"));
children.push(bul("配置驱动：哪些识别器启用、各自的目标格式、置信度阈值，都走配置文件。"));
children.push(code("registry.register({"));
children.push(code("  blockType: 'formula',"));
children.push(code("  recognizer: FormulaRecognizer,"));
children.push(code("  transcoder: LatexTranscoder,"));
children.push(code("  minConfidence: 0.6,"));
children.push(code("})"));

// 6
children.push(h1("六、统一输出 Schema"));
children.push(p("无论区域里是什么，服务都返回同一种结构，客户端 / Agent 只需按这一个 schema 解析："));
children.push(code("{"));
children.push(code("  \"ok\": true,"));
children.push(code("  \"blocks\": ["));
children.push(code("    {"));
children.push(code("      \"id\": \"b1\","));
children.push(code("      \"type\": \"formula\",          // 块类型"));
children.push(code("      \"order\": 1,                   // 阅读顺序"));
children.push(code("      \"bbox\": [x, y, w, h],         // 区域内坐标"));
children.push(code("      \"target\": \"latex\",          // 转码目标格式"));
children.push(code("      \"encoded\": \"\\\\frac{1}{2}\", // 机器语言表示"));
children.push(code("      \"raw_text\": \"1/2\",          // 兜底的原始文本"));
children.push(code("      \"confidence\": 0.93"));
children.push(code("    }"));
children.push(code("    // ... 更多块"));
children.push(code("  ],"));
children.push(code("  \"reading_text\": \"...\"            // 全部块按阅读顺序拼出的可读文本"));
children.push(code("}"));
children.push(p("说明：每块同时给出「encoded（机器语言）」和「raw_text（原始文本兜底）」，下游可优先用结构化结果，必要时回退到原始文本。"));
children.push(p("特例：type=chart 的块没有 encoded / raw_text，而是带一个 image_crop 字段（该块的图像裁剪），由下游多模态 LLM 据此生成描述。"));

// 7
children.push(h1("七、非功能要求"));
children.push(table([2400, 6960], ["方面", "要求"], [
  ["不留存", "收到帧 → 提取 → 立即销毁；不写图、不写含画面的日志（呼应视觉功能铁律）"],
  ["鉴权", "客户端与服务之间 token / 证书鉴权；接口不对公网裸奔"],
  ["性能", "区块并行识别；只处理客户端发来的「有变化的帧」；控制单帧延迟"],
  ["可观测", "只记录不含画面内容的指标日志（延迟、各识别器命中率、置信度分布）"],
  ["可降级", "某识别器 / 转码器异常时，该块回退为纯文本，不拖垮整帧"],
  ["资源隔离", "识别器在受限环境运行，单帧超时即中止，防止拖垮服务"],
]));

// 8
children.push(h1("八、目录结构（建议）"));
children.push(p("vision-service/"));
children.push(bul("api/ —— 接入层：接口、鉴权、校验、限流"));
children.push(bul("pipeline/ —— 流水线编排：预处理、版面分析、分派、合并、输出"));
children.push(bul("recognizers/ —— 各专项识别器（文本 / 表格 / 公式 / 代码 / 符号 / 图表）"));
children.push(bul("transcoders/ —— 各转码器（latex / table-json / code / smiles / mermaid …）"));
children.push(bul("registry/ —— 识别器与转码器注册表 + 配置加载"));
children.push(bul("schema/ —— 统一输出 schema 定义"));
children.push(bul("config/ —— 启用项、目标格式、置信度阈值等配置"));

// 9
children.push(h1("九、待办与衔接"));
children.push(bul("先定接口契约：接入层的输入 / 输出 schema 先冻结，客户端和服务端可并行开发；"));
children.push(bul("M3：搭流水线骨架 + 接入层 + 文本 OCR + 表格识别器 + 对应转码器，先打通主链路；"));
children.push(bul("M3：版面分析 + 区块分派（含 chart 块直通）+ 结构化合并；"));
children.push(bul("M4：公式（→LaTeX）、代码识别器与转码器补齐；"));
children.push(bul("M4：符号识别器（二期）；置信度回退、可观测、资源隔离等非功能项。"));
children.push(h2("9.1 与其它文档的衔接"));
children.push(bul("本服务的接口即《桌宠视觉功能》中「客户端 → 你的服务器」那一段，输出 schema 需两边对齐；"));
children.push(bul("输出的结构化结果，是《桌宠视觉功能》里 Agent / LLM 做问答的输入；"));
children.push(bul("chart 块的图像裁剪交给 LLM 描述，这条链路需与《桌宠视觉功能》的第三方 LLM 处理对齐；"));
children.push(bul("「不留存」「鉴权」需纳入主方案第六章《权限与安全设计》一并管理。"));
children.push(h2("9.2 已确认的关键决策"));
children.push(table([3000, 6360], ["决策点", "结论"], [
  ["图表 / 流程图", "不在本服务转码；标记 chart 块、附图像裁剪，交由（多模态）LLM 描述"],
  ["公式转码目标", "LaTeX"],
  ["表格转码目标", "结构化 JSON（行列 + 表头）"],
  ["一期识别器范围", "文本 + 表格 + 公式 + 代码；符号识别器放二期"],
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
      children: [new TextRun({ text: "DeskPet — 非 LLM 视觉服务 框架设计", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("written:", process.argv[2]); });
