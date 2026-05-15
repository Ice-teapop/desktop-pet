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
function code(t) { return new Paragraph({ spacing: { after: 16 }, shading: { fill: "F2F2F2", type: ShadingType.CLEAR }, children: [new TextRun({ text: t === "" ? " " : t, font: "Consolas", size: 18 })] }); }
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
function table(colWidths, header, rows, monoCols) {
  monoCols = monoCols || [];
  const total = colWidths.reduce((a, b) => a + b, 0);
  const headRow = new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, { w: colWidths[i], bold: true, fill: "2E5C8A", color: "FFFFFF" })) });
  const bodyRows = rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, { w: colWidths[i], fill: ri % 2 ? "F2F5F8" : "FFFFFF", mono: monoCols.includes(i) })) }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: colWidths, rows: [headRow, ...bodyRows] });
}

const children = [];

children.push(
  new Paragraph({ spacing: { before: 2300, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "视觉服务接口契约", bold: true, size: 52, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "API Contract v1（冻结稿）", bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "智能桌宠助手 DeskPet — 桌宠客户端 ↔ 非 LLM 视觉服务", size: 24, color: "595959" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 },
    children: [new TextRun({ text: "契约一旦冻结，客户端与服务端即可并行开发", size: 20, color: "1E5C42" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "视觉服务接口契约 — API Contract v1"],
  ["所属方案", "智能桌宠助手 DeskPet 完整方案设计文档"],
  ["版本", "v1.0（冻结稿）"],
  ["日期", "2026-05-15"],
  ["接口双方", "桌宠客户端（瘦客户端，发起方）↔ 非 LLM 视觉服务（用户服务器，提供方）"],
  ["协议", "HTTPS + JSON / multipart"],
  ["状态", "冻结 —— 修改须走第八章的演进规则"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1
children.push(h1("一、概述"));
children.push(p("本文档定义桌宠客户端与「非 LLM 视觉服务」之间的接口契约。客户端把用户划定区域的画面帧发给服务，服务返回结构化的提取结果。"));
children.push(p("先冻结契约的意义：契约一旦确定，客户端团队可以照着请求 / 响应格式开发并用 mock 服务联调，服务端团队可以照着同一份契约实现流水线，两边互不阻塞、并行推进。"));
children.push(callout("阅读前提", [
  "本契约是《非 LLM 视觉服务 — 框架设计》的接口层形式化，二者需保持一致。",
  "已确认的相关决策：公式转码目标为 LaTeX；表格转码目标为结构化 JSON；图表不转码、由服务返回图像裁剪交下游 LLM 描述；一期识别器覆盖 文本 / 表格 / 公式 / 代码。",
]));
children.push(h2("1.1 术语"));
children.push(table([2200, 7160], ["术语", "含义"], [
  ["帧 frame", "客户端捕获的、用户划定区域的一张静态画面"],
  ["区块 block", "服务在一帧中切分出的语义单元（文本 / 表格 / 公式 / 代码 / 符号 / 图表 等）"],
  ["encoded", "区块被转码后的「机器可理解表示」"],
  ["target", "encoded 采用的目标格式（如 latex、table-json）"],
]));

// 2
children.push(h1("二、传输与通用约定"));
children.push(h2("2.1 协议与基址"));
children.push(bul("全部接口走 HTTPS，强制 TLS；"));
children.push(bul("服务基址（Base URL）由用户在桌宠客户端设置中填写，例如 https://your-server.example.com；"));
children.push(bul("所有路径带版本前缀 /v1，完整形式：{BaseURL}/v1/{path}。"));
children.push(h2("2.2 认证"));
children.push(bul("采用 Bearer Token：客户端在请求头携带 Authorization: Bearer {token}；"));
children.push(bul("token 由用户在客户端与服务端两侧配置一致；"));
children.push(bul("缺失 / 错误 token 一律返回 401。"));
children.push(h2("2.3 通用请求头"));
children.push(table([3000, 2400, 3960], ["请求头", "是否必填", "说明"], [
  ["Authorization", "必填", "Bearer {token}"],
  ["X-DeskPet-Client", "必填", "客户端版本号，如 deskpet/0.1.0"],
  ["X-Request-Id", "选填", "客户端生成的请求 ID；不填则服务端生成并在响应回传"],
]));
children.push(h2("2.4 版本策略"));
children.push(bul("路径级版本：/v1、/v2 …；v1 在生命周期内只做向后兼容的增量变更；"));
children.push(bul("破坏性变更必须升版本号，旧版本保留过渡期（见第八章）。"));

// 3
children.push(h1("三、接口列表"));
children.push(table([2600, 1400, 5360], ["接口", "方法", "用途"], [
  ["/v1/extract", "POST", "提交一帧画面，返回结构化提取结果（主接口）"],
  ["/v1/capabilities", "GET", "查询服务能力：启用了哪些识别器、各自的目标格式、限制项"],
  ["/v1/health", "GET", "健康检查，用于客户端探活"],
]));

// 4
children.push(h1("四、POST /v1/extract 详解"));
children.push(h2("4.1 请求"));
children.push(bul("Content-Type：multipart/form-data，包含两个部分；"));
children.push(bul("part「image」：帧图像二进制，image/png（首选）或 image/jpeg；"));
children.push(bul("part「metadata」：application/json，字段见 4.2。"));
children.push(h2("4.2 请求 metadata 字段"));
children.push(table([2200, 1500, 1300, 4360], ["字段", "类型", "必填", "说明"], [
  ["region_id", "string", "必填", "用户划定的观察区域 ID，标识这一帧来自哪个区域"],
  ["frame_seq", "int", "必填", "客户端帧序号，单调递增，用于排序与对账"],
  ["captured_at", "string", "必填", "帧捕获时间，ISO 8601，如 2026-05-15T06:30:00Z"],
  ["region_size", "object", "必填", "区域像素尺寸 { w:int, h:int }"],
  ["content_hash", "string", "必填", "客户端对该帧算的感知哈希，供对账 / 去重，服务端不据此缓存"],
  ["options", "object", "选填", "见 4.3"],
]));
children.push(h3("4.3 metadata.options 字段"));
children.push(table([2400, 1400, 1300, 4260], ["字段", "类型", "默认", "说明"], [
  ["include_reading_text", "bool", "true", "是否在响应里返回按阅读顺序拼出的 reading_text"],
  ["include_chart_crop", "bool", "true", "chart 块是否返回 image_crop（关掉则只给 bbox）"],
  ["max_blocks", "int", "200", "单帧最多返回的区块数，超出按阅读顺序截断"],
]));
children.push(h2("4.4 响应体（200 OK）"));
children.push(code('{'));
children.push(code('  "ok": true,'));
children.push(code('  "request_id": "req_8f3a1c",'));
children.push(code('  "region_id": "region_1",'));
children.push(code('  "frame_seq": 1287,'));
children.push(code('  "blocks": [ /* 见第五章，每个元素是一个区块 */ ],'));
children.push(code('  "reading_text": "...",          // 全部区块按阅读顺序拼出的可读文本'));
children.push(code('  "meta": {'));
children.push(code('    "latency_ms": 142,'));
children.push(code('    "pipeline_version": "vision-svc/0.1.0",'));
children.push(code('    "recognizers_used": ["text", "table", "formula"]'));
children.push(code('  }'));
children.push(code('}'));
children.push(h2("4.5 响应顶层字段"));
children.push(table([2200, 1500, 5660], ["字段", "类型", "说明"], [
  ["ok", "bool", "成功恒为 true；失败见第六章"],
  ["request_id", "string", "本次请求 ID，与 X-Request-Id 一致或服务端生成"],
  ["region_id", "string", "回显请求中的 region_id"],
  ["frame_seq", "int", "回显请求中的 frame_seq"],
  ["blocks", "array", "区块数组，元素结构见第五章；按 order 升序"],
  ["reading_text", "string", "按阅读顺序拼出的纯文本；options 关闭时为空串"],
  ["meta", "object", "处理元信息：耗时、流水线版本、本帧用到的识别器"],
]));
children.push(h2("4.6 完整示例"));
children.push(p("请求 metadata："));
children.push(code('{ "region_id": "region_1", "frame_seq": 1287,'));
children.push(code('  "captured_at": "2026-05-15T06:30:00Z",'));
children.push(code('  "region_size": { "w": 640, "h": 320 },'));
children.push(code('  "content_hash": "p:9a3f...e1", "options": {} }'));
children.push(p("响应："));
children.push(code('{'));
children.push(code('  "ok": true, "request_id": "req_8f3a1c",'));
children.push(code('  "region_id": "region_1", "frame_seq": 1287,'));
children.push(code('  "blocks": ['));
children.push(code('    { "id": "b1", "type": "heading", "order": 1,'));
children.push(code('      "bbox": [12, 8, 300, 28], "target": "text",'));
children.push(code('      "encoded": "求解步骤", "raw_text": "求解步骤",'));
children.push(code('      "confidence": 0.98 },'));
children.push(code('    { "id": "b2", "type": "formula", "order": 2,'));
children.push(code('      "bbox": [12, 44, 220, 40], "target": "latex",'));
children.push(code('      "encoded": "\\\\frac{1}{2}x^2 + C",'));
children.push(code('      "raw_text": "1/2 x^2 + C", "confidence": 0.91 }'));
children.push(code('  ],'));
children.push(code('  "reading_text": "求解步骤\\n1/2 x^2 + C",'));
children.push(code('  "meta": { "latency_ms": 142,'));
children.push(code('    "pipeline_version": "vision-svc/0.1.0",'));
children.push(code('    "recognizers_used": ["text", "formula"] }'));
children.push(code('}'));

// 5
children.push(h1("五、区块类型与 encoded 规范"));
children.push(h2("5.1 区块通用字段"));
children.push(table([2000, 1400, 5960], ["字段", "类型", "说明"], [
  ["id", "string", "区块在本帧内的唯一 ID"],
  ["type", "string", "区块类型枚举，见 5.2"],
  ["order", "int", "阅读顺序序号，从 1 递增"],
  ["bbox", "int[4]", "区块在区域内的坐标 [x, y, w, h]，像素"],
  ["target", "string|null", "encoded 的目标格式；chart / unknown 为 null"],
  ["encoded", "string|object|null", "机器可理解表示，结构随 type 而定，见 5.2"],
  ["raw_text", "string", "原始 OCR 文本兜底；chart 可为空串"],
  ["confidence", "float", "0~1，转码 / 识别置信度"],
  ["image_crop", "string|null", "仅 type=chart 提供：该区块的 PNG 图像裁剪，base64"],
  ["notes", "string|null", "标记位，如 low_confidence、untranscoded"],
]));
children.push(h2("5.2 各类型的 type / target / encoded"));
children.push(table([1500, 1500, 2100, 4260],
  ["type", "target", "encoded 结构", "示例"],
  [
    ["text", "text", "string（纯文本）", '"这是一段文字"'],
    ["heading", "text", "string（纯文本）", '"第一章"'],
    ["table", "table-json", "{ headers:string[], rows:string[][] }", '{ "headers":["A","B"], "rows":[["1","2"]] }'],
    ["formula", "latex", "string（LaTeX）", '"\\\\sum_{i=1}^{n} i"'],
    ["code", "code", "{ lang:string, text:string }", '{ "lang":"python", "text":"def f():\\n    pass" }'],
    ["symbol", "unicode", "{ char:string, codepoint:string, name:string }", '{ "char":"α", "codepoint":"U+03B1", "name":"greek alpha" }'],
    ["error", "error-json", "{ error_type, file, line, message, stack }", '{ "error_type":"TypeError", "line":12, ... }'],
    ["chart", "null", "null（改用 image_crop）", "encoded=null, image_crop=<base64 png>"],
    ["unknown", "null", "null（只给 raw_text）", "encoded=null, raw_text=\"...\""],
  ], [3]));
children.push(h2("5.3 逐类型说明"));
children.push(bul("text / heading：纯文字内容，encoded 即文本本身；heading 额外表示这是标题。"));
children.push(bul("table：encoded 为结构化 JSON，headers 为表头数组，rows 为二维数组；合并单元格以重复值或空串表示，具体在实现期细化但不改字段结构。"));
children.push(bul("formula：encoded 为 LaTeX 字符串；raw_text 给出近似的线性文本兜底。"));
children.push(bul("code：encoded 含 lang（识别出的语言，识别不出为 \"plain\"）与 text（保留缩进、空白、转义的源码）。"));
children.push(bul("symbol：孤立特殊符号，给出字符本身、Unicode 码点、标准名称。"));
children.push(bul("error：终端 / IDE 报错的结构化拆解；字段缺失时置 null。"));
children.push(bul("chart：图表 / 流程图 / 示意图。服务不转码，encoded=null、target=null，改为提供 image_crop，交由下游多模态 LLM 描述。"));
children.push(bul("unknown：识别不出类型或无对应识别器，encoded=null，仅 raw_text，notes 标 untranscoded。"));
children.push(callout("置信度与兜底约定", [
  "凡 confidence 低于服务配置阈值的区块，notes 必须标 low_confidence，且 raw_text 必须有值，让客户端 / Agent 能回退到原始文本。",
  "服务端绝不「猜一个看似正确的结构」—— 没把握就降级为 unknown 或标 low_confidence。",
], "2E7D5B"));

// 6
children.push(h1("六、错误处理"));
children.push(h2("6.1 HTTP 状态码"));
children.push(table([1600, 3000, 4760], ["状态码", "含义", "客户端处理建议"], [
  ["200", "成功", "正常解析响应体"],
  ["400", "请求格式错误", "属客户端 bug，记录并上报，不重试"],
  ["401", "认证失败", "提示用户检查 token 配置"],
  ["413", "图像过大", "客户端压缩 / 缩小区域后再试"],
  ["422", "无法处理该帧", "跳过本帧，等下一帧"],
  ["429", "触发限流", "按 Retry-After 退避后重试"],
  ["500", "服务端内部错误", "短暂退避重试，连续失败则提示用户"],
  ["503", "服务不可用", "标记服务离线，暂停盯守上传，定时探活"],
]));
children.push(h2("6.2 错误响应体"));
children.push(code('{'));
children.push(code('  "ok": false,'));
children.push(code('  "request_id": "req_8f3a1c",'));
children.push(code('  "error": {'));
children.push(code('    "code": "IMAGE_TOO_LARGE",'));
children.push(code('    "message": "frame exceeds 8 MB limit"'));
children.push(code('  }'));
children.push(code('}'));
children.push(h2("6.3 错误码枚举"));
children.push(table([2600, 1400, 5360], ["error.code", "对应状态码", "说明"], [
  ["UNAUTHORIZED", "401", "token 缺失或错误"],
  ["INVALID_REQUEST", "400", "请求结构 / 字段不合法"],
  ["INVALID_IMAGE", "400 / 422", "图像无法解码或格式不支持"],
  ["IMAGE_TOO_LARGE", "413", "超过 max_image_bytes"],
  ["RATE_LIMITED", "429", "超出速率限制，配合 Retry-After"],
  ["PIPELINE_ERROR", "500", "流水线处理异常"],
  ["SERVICE_UNAVAILABLE", "503", "服务启动中 / 过载 / 维护"],
]));

// 7
children.push(h1("七、非功能约定"));
children.push(table([2600, 6760], ["项", "约定"], [
  ["不留存", "服务端收到帧 → 提取 → 立即销毁原始帧与中间产物；不写图、不写含画面内容的日志"],
  ["传输安全", "强制 HTTPS / TLS；token 不出现在 URL，只在请求头"],
  ["最大图像", "默认单帧 ≤ 8 MB；实际值以 /v1/capabilities 返回的 max_image_bytes 为准"],
  ["超时", "客户端请求超时建议 10 s；服务端单帧处理超时建议 8 s，超时返回 500/PIPELINE_ERROR"],
  ["限流", "服务端按 token 限流；触发返回 429 + Retry-After"],
  ["幂等", "extract 无副作用，天然幂等；客户端可安全重试（注意退避）"],
  ["可观测", "服务端只记不含画面内容的指标（延迟、识别器命中率、错误率）"],
]));
children.push(h2("7.1 /v1/capabilities 响应"));
children.push(code('{'));
children.push(code('  "pipeline_version": "vision-svc/0.1.0",'));
children.push(code('  "recognizers": ["text", "table", "formula", "code"],'));
children.push(code('  "targets": { "formula": "latex", "table": "table-json",'));
children.push(code('               "code": "code", "symbol": "unicode" },'));
children.push(code('  "max_image_bytes": 8388608,'));
children.push(code('  "limits": { "rate_per_min": 120, "max_blocks": 200 }'));
children.push(code('}'));
children.push(h2("7.2 /v1/health 响应"));
children.push(code('{ "ok": true, "status": "healthy", "pipeline_version": "vision-svc/0.1.0" }'));

// 8
children.push(h1("八、契约演进规则"));
children.push(bul("向后兼容（不升版本，可直接发布）：新增可选请求字段、新增响应字段、新增 type / error.code 枚举值、新增接口；"));
children.push(bul("破坏性变更（必须升 /v2）：删除 / 重命名字段、改字段类型、改字段语义、改必填性、删枚举值；"));
children.push(bul("客户端实现要求：解析响应时对未知字段、未知 type、未知 error.code 做「忽略 / 降级」处理，不得直接崩溃 —— 这样服务端做兼容性增量时客户端无需同步升级；"));
children.push(bul("任何变更都需更新本文档版本号与变更记录，并通知客户端 / 服务端两侧。"));
children.push(callout("冻结后的纪律", [
  "本契约 v1 一经双方确认即冻结。冻结后，字段不再随口改 —— 要改就走上面的演进规则。",
  "这正是「先冻结契约」的价值：两边照同一份不变的契约各自开发，联调时才不会对不上。",
], "C0392B"));

// 9
children.push(h1("九、待办与衔接"));
children.push(bul("双方确认本契约 → 正式冻结 v1；"));
children.push(bul("客户端侧：按本契约实现 extract 调用 + 一个本地 mock 服务（按 schema 返回假数据）即可先行联调；"));
children.push(bul("服务端侧：按本契约实现 /v1/extract、/v1/capabilities、/v1/health 三个接口的外壳，内部流水线按《非 LLM 视觉服务 — 框架设计》逐步填充；"));
children.push(bul("把 reading_text、blocks 接入《桌宠视觉功能》里 Agent 的「读取观察区域」感知工具；"));
children.push(bul("把 token、Base URL 配置项登记进主方案的配置模块；不留存、鉴权纳入主方案第六章。"));
children.push(h2("9.1 与其它文档的衔接"));
children.push(bul("本契约是《非 LLM 视觉服务 — 框架设计》接入层与输出层的形式化，字段须与框架文档第六章一致；"));
children.push(bul("响应中的 chart 块（image_crop）交下游 LLM 的链路，与《桌宠视觉功能》的第三方 LLM 处理对齐。"));

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
      children: [new TextRun({ text: "DeskPet — 视觉服务接口契约 v1", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("written:", process.argv[2]); });
