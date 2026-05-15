const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require("docx");

// ---------- helpers ----------
const FONT = "Microsoft YaHei";
const border = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] }); }
function h3(t) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] }); }
function p(t) { return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(t)] }); }
function bul(t) { return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] }); }
function bul2(t) { return new Paragraph({ numbering: { reference: "bullets", level: 1 }, spacing: { after: 40 }, children: [new TextRun(t)] }); }

function cell(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text: String(text), bold: !!opts.bold, color: opts.color })];
  return new TableCell({
    borders, margins: cellMargins,
    width: { size: opts.w, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: runs, alignment: opts.align })],
  });
}

function table(colWidths, header, rows) {
  const total = colWidths.reduce((a, b) => a + b, 0);
  const headRow = new TableRow({
    tableHeader: true,
    children: header.map((t, i) => cell(t, { w: colWidths[i], bold: true, fill: "2E5C8A", color: "FFFFFF" })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((t, i) => cell(t, { w: colWidths[i], fill: ri % 2 ? "F2F5F8" : "FFFFFF" })),
  }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: colWidths, rows: [headRow, ...bodyRows] });
}
const CW = 9360;

// ---------- content ----------
const children = [];

// Cover
children.push(
  new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "智能桌宠助手 DeskPet", bold: true, size: 56, color: "2E5C8A" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "完整方案设计文档", bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 },
    children: [new TextRun({ text: "一个常驻桌面、能看会动、可调用电脑能力的 AI 伙伴", size: 24, color: "595959" })] }),
);
children.push(table([3120, 6240], ["项目信息", "内容"], [
  ["文档名称", "智能桌宠助手 DeskPet — 完整方案设计文档"],
  ["版本", "v1.0（方案设计稿）"],
  ["日期", "2026-05-15"],
  ["目标平台", "macOS（优先）/ Windows / Linux"],
  ["技术路线", "Electron + TypeScript + React"],
  ["文档状态", "待评审"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

// TOC
children.push(h1("目录"));
children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1
children.push(h1("一、项目概述"));
children.push(h2("1.1 项目背景"));
children.push(p("近年来出现了一批「桌面 AI 伴侣」类产品（如用户提到的 claw 等），它们把传统的“桌宠”——一个停在屏幕上的卡通小角色——和大语言模型的能力结合起来：它不再只是看着可爱，而是真的能听懂你说话、帮你处理文件、运行命令、完成任务。本项目即对标这类产品，打造一个常驻桌面、具备完整电脑操作能力的智能桌宠。"));
children.push(h2("1.2 产品愿景"));
children.push(p("让用户在桌面上拥有一个“活的助手”：平时它是一个会走动、有表情、可被拖拽和逗弄的小角色；需要时只要对它说一句话，它就能调用电脑的文件系统、终端、应用程序去真正地把事情做完。核心理念是“陪伴感 + 真实生产力”的结合。"));
children.push(h2("1.3 目标用户"));
children.push(bul("希望桌面有趣、有陪伴感的普通用户；"));
children.push(bul("经常做文件整理、批量重命名、脚本自动化的效率型用户；"));
children.push(bul("希望用自然语言代替记命令、记操作路径的非技术用户。"));
children.push(h2("1.4 核心价值"));
children.push(bul("自然语言即操作：说人话就能让电脑干活，不必记命令；"));
children.push(bul("常驻不打扰：以桌宠形态存在，需要时呼出，不需要时安静待命；"));
children.push(bul("能力真实：不是聊天玩具，而是能落地执行文件操作和系统命令的 Agent；"));
children.push(bul("安全可控：强大的能力配套清晰的权限与确认机制（详见第六章）。"));

// 2
children.push(h1("二、核心功能需求"));
children.push(p("根据需求确认，本产品包含四大核心能力模块："));
children.push(h2("2.1 桌面互动动画"));
children.push(bul("透明无边框窗口，角色悬浮在所有窗口之上，背景完全透明；"));
children.push(bul("待机、行走、被拖拽、说话、思考、睡觉等多种动画状态；"));
children.push(bul("可用鼠标拖动到屏幕任意位置，支持贴边、自动巡游；"));
children.push(bul("点击/双击/右键触发互动（摸头反馈、呼出菜单、呼出对话框）；"));
children.push(bul("非交互区域“鼠标点击穿透”，不影响正常使用电脑。"));
children.push(h2("2.2 AI 对话"));
children.push(bul("点击桌宠或使用全局快捷键呼出对话气泡 / 输入框；"));
children.push(bul("接入大语言模型（云端 API 或本地模型），支持流式输出；"));
children.push(bul("具备多轮上下文记忆与基础长期记忆（用户偏好、常用路径）；"));
children.push(bul("作为 Agent 内核：能把用户意图拆解为“文件操作 / 命令执行”等工具调用。"));
children.push(h2("2.3 文件 / 文件夹操作"));
children.push(bul("浏览、搜索、读取文件内容；"));
children.push(bul("新建、复制、移动、重命名、删除文件与文件夹；"));
children.push(bul("批量操作（按规则批量重命名、按类型归类整理）；"));
children.push(bul("所有写操作（移动/删除/覆盖）默认走确认与回收站，可审计、可撤销。"));
children.push(h2("2.4 系统命令 / 脚本执行"));
children.push(bul("执行 shell 命令、运行脚本（bash / python 等）；"));
children.push(bul("打开应用程序、打开文件 / 文件夹 / 网址；"));
children.push(bul("注册定时任务 / 自动化流程；"));
children.push(bul("命令执行前经过安全网关校验（白名单 / 黑名单 / 用户确认）。"));
children.push(h2("2.5 功能优先级"));
children.push(table([1500, 4260, 1800, 1800], ["优先级", "功能", "所属模块", "里程碑"], [
  ["P0 必须", "透明桌宠窗口 + 基础动画 + 拖拽", "动画引擎", "M1"],
  ["P0 必须", "AI 对话（流式）", "Agent 引擎", "M1"],
  ["P0 必须", "文件读取 / 浏览 / 搜索", "文件模块", "M2"],
  ["P0 必须", "权限与确认机制", "安全网关", "M2"],
  ["P1 重要", "文件写操作（移动/重命名/删除）", "文件模块", "M2"],
  ["P1 重要", "系统命令执行", "命令模块", "M3"],
  ["P1 重要", "Agent 工具编排（多步任务）", "Agent 引擎", "M3"],
  ["P2 增强", "长期记忆 / 用户偏好", "Agent 引擎", "M4"],
  ["P2 增强", "定时任务 / 自动化", "命令模块", "M4"],
  ["P2 增强", "皮肤 / 角色自定义", "动画引擎", "M4"],
]));

// 3
children.push(h1("三、技术选型"));
children.push(h2("3.1 为什么选择 Electron"));
children.push(p("综合“桌面悬浮窗、透明背景、跨平台、系统能力调用、开发效率”几方面权衡，推荐 Electron 作为主框架。下表为候选方案对比："));
children.push(table([1800, 2400, 2400, 2760], ["方案", "优势", "劣势", "结论"], [
  ["Electron + TS（推荐）", "透明/置顶/穿透窗口成熟；Node 调系统能力强；生态丰富；跨平台；开发快", "安装包较大；内存占用偏高", "✔ 采用：能力与开发效率最均衡"],
  ["Python + PyQt", "上手简单；脚本类操作方便", "桌宠动画与透明窗体体验一般；打包分发麻烦", "不采用"],
  ["Swift 原生", "性能最佳；最贴合 macOS", "门槛高；无法跨平台；迭代慢", "不采用（除非后续做 macOS 专属版）"],
  ["Tauri（Rust+Web）", "体积小；性能好；安全模型佳", "桌宠类透明窗口生态不如 Electron；系统能力需写 Rust", "备选：体积/性能敏感时再迁移"],
]));
children.push(h2("3.2 完整技术栈"));
children.push(table([2600, 3200, 3560], ["层", "技术", "说明"], [
  ["桌面框架", "Electron", "主进程 + 渲染进程，跨平台壳"],
  ["开发语言", "TypeScript", "全栈类型安全"],
  ["UI 框架", "React + Vite", "对话面板、设置页、菜单"],
  ["桌宠动画", "Canvas / Lottie / 帧动画 + CSS", "渲染角色与状态动画"],
  ["状态管理", "Zustand 或 Redux", "桌宠状态、会话状态"],
  ["AI 接入", "云端 LLM API（可插拔）/ 可选本地模型", "Agent 内核，支持流式"],
  ["系统能力", "Node.js（fs、child_process、path）", "文件与命令操作"],
  ["数据持久化", "SQLite / better-sqlite3 + 本地 JSON", "会话历史、配置、审计日志"],
  ["打包分发", "electron-builder", "生成 dmg / exe / AppImage"],
  ["进程通信", "Electron IPC（contextBridge 隔离）", "渲染进程与主进程安全通信"],
]));

// 4
children.push(h1("四、系统架构"));
children.push(h2("4.1 总体架构"));
children.push(p("系统采用 Electron 经典的“主进程 / 渲染进程”双层结构，并在主进程侧内嵌一个 Agent 内核与安全网关。所有具备危险性的能力（文件写、命令执行）只在主进程执行，渲染进程永远不直接接触系统 API。"));
children.push(p("数据流向：用户在桌宠界面输入 → 渲染进程通过 IPC 发给主进程 → Agent 引擎理解意图并规划工具调用 → 工具调用先经过安全网关（鉴权 / 确认 / 审计）→ 文件模块或命令模块执行 → 结果回传 Agent → 生成回复 → 流式推回渲染进程显示。"));
children.push(h2("4.2 进程职责划分"));
children.push(table([2400, 7000], ["进程", "职责"], [
  ["渲染进程 (Renderer)", "桌宠角色渲染与动画、对话气泡 UI、设置界面、菜单。只负责“显示与采集输入”，无系统权限。"],
  ["预加载脚本 (Preload)", "通过 contextBridge 暴露受限、白名单化的 IPC 接口，隔离渲染进程与 Node 环境。"],
  ["主进程 (Main)", "承载 Agent 引擎、安全网关、文件模块、命令模块、持久化、全局快捷键、托盘。所有敏感操作的唯一执行者。"],
]));
children.push(h2("4.3 模块划分"));
children.push(bul("桌宠窗口与动画引擎（渲染进程）"));
children.push(bul("AI 对话与 Agent 引擎（主进程）"));
children.push(bul("文件操作模块（主进程）"));
children.push(bul("命令执行模块（主进程）"));
children.push(bul("权限与安全网关（主进程，横切所有敏感模块）"));
children.push(bul("配置与持久化模块（主进程）"));

// 5
children.push(h1("五、模块详细设计"));

children.push(h2("5.1 桌宠窗口与动画引擎"));
children.push(h3("关键实现点"));
children.push(bul("窗口设置：transparent: true、frame: false、alwaysOnTop: true、skipTaskbar: true、hasShadow: false；"));
children.push(bul("点击穿透：默认 setIgnoreMouseEvents(true, { forward: true })，鼠标移到角色实体像素上时再动态关闭穿透，实现“只有角色本身可点”；"));
children.push(bul("动画状态机：idle（待机）、walk（行走）、drag（被拖拽）、talk（说话）、think（思考）、sleep（休眠）等状态及其切换条件；"));
children.push(bul("资源形式：推荐 Lottie 或精灵帧序列，便于后续换肤；"));
children.push(bul("多屏支持：记录角色坐标，处理分辨率变化与屏幕热插拔。"));
children.push(h3("交互设计"));
children.push(table([2600, 6760], ["操作", "响应"], [
  ["左键拖拽", "进入 drag 动画，角色跟随鼠标移动"],
  ["单击", "呼出 / 收起对话输入框"],
  ["双击", "播放亲密互动动画（摸头 / 卖萌）"],
  ["右键", "弹出功能菜单（对话、设置、暂停巡游、退出等）"],
  ["长时间无操作", "进入 sleep 状态，降低资源占用"],
]));

children.push(h2("5.2 AI 对话与 Agent 引擎"));
children.push(p("Agent 引擎是产品的“大脑”，负责把自然语言转成可执行的工具调用序列。"));
children.push(h3("核心组成"));
children.push(bul("对话管理：多轮上下文、会话历史、token 预算控制；"));
children.push(bul("工具注册表（Tool Registry）：把文件模块、命令模块的能力声明为带 JSON Schema 的“工具”，供模型调用；"));
children.push(bul("规划与执行循环：理解意图 → 选择工具 → 调用 → 观察结果 → 决定下一步，直到任务完成；"));
children.push(bul("流式输出：回复与“正在执行 xxx”状态实时推送给桌宠气泡；"));
children.push(bul("记忆：短期（当前会话）+ 长期（用户偏好、常用目录、习惯），存入本地数据库。"));
children.push(h3("可调用工具一览（示例）"));
children.push(table([2600, 3400, 3360], ["工具", "入参", "说明"], [
  ["list_dir", "path", "列出目录内容"],
  ["read_file", "path", "读取文本文件内容"],
  ["search_files", "root, keyword", "按名称/内容搜索"],
  ["move_file", "src, dst", "移动/重命名（敏感，需确认）"],
  ["delete_file", "path", "删除到回收站（敏感，需确认）"],
  ["run_command", "command, cwd", "执行 shell 命令（高危，需确认）"],
  ["open_app", "appName / path", "打开应用或文件"],
]));

children.push(h2("5.3 文件操作模块"));
children.push(bul("基于 Node.js fs / path 实现，全部在主进程执行；"));
children.push(bul("读操作（list / read / search）相对低危，可配置为免确认；"));
children.push(bul("写操作（move / rename / delete / overwrite）默认高危，需经安全网关；"));
children.push(bul("删除一律走系统回收站（trash），不做不可逆删除；"));
children.push(bul("批量操作前先生成“变更预览清单”给用户确认，再整体执行；"));
children.push(bul("所有写操作记录审计日志，支持按操作回滚（移动类可逆）。"));

children.push(h2("5.4 命令执行模块"));
children.push(bul("基于 child_process（spawn / exec）实现；"));
children.push(bul("默认在受限工作目录、受限环境变量下执行；"));
children.push(bul("命令、参数、工作目录在执行前完整展示给用户确认；"));
children.push(bul("支持超时控制、输出大小限制、随时中止正在运行的进程；"));
children.push(bul("命中“危险命令黑名单”时直接拦截并提示（详见 6.5）；"));
children.push(bul("全部执行记录写入审计日志。"));

children.push(h2("5.5 权限与安全网关"));
children.push(p("安全网关是一个横切模块，所有敏感工具调用（文件写、命令执行）都必须先经过它。它负责：能力分级判定、是否需要用户确认、是否命中黑名单、写入审计日志。详细设计见第六章。"));

children.push(h2("5.6 配置与持久化"));
children.push(table([2600, 6760], ["数据", "存储方式"], [
  ["应用设置（皮肤、快捷键、权限策略）", "本地 JSON 配置文件"],
  ["会话历史与长期记忆", "SQLite 数据库"],
  ["审计日志", "SQLite（独立表）+ 可导出"],
  ["API 密钥等敏感信息", "操作系统钥匙串 / 加密存储，不明文落盘"],
]));

// 6
children.push(h1("六、权限与安全设计"));
children.push(p("用户期望桌宠“能完全访问电脑”。能力越大，越需要把安全设计放在第一位——本章是本方案的重点。设计原则：能力强大，但每一步危险操作都可见、可控、可审计、可撤销。"));
children.push(h2("6.1 风险分析"));
children.push(table([2600, 6760], ["风险", "说明"], [
  ["误操作", "AI 理解偏差导致删错 / 移错文件"],
  ["危险命令", "执行了破坏性 shell 命令（如递归删除、格式化）"],
  ["提示注入", "读取的文件 / 网页内容里藏有恶意指令，诱导 Agent 执行危险操作"],
  ["权限过大", "渲染进程若直连系统 API，被攻破即等于交出整机"],
  ["隐私泄露", "敏感文件内容被上传到云端模型"],
]));
children.push(h2("6.2 权限分级模型"));
children.push(p("把所有操作按危险程度分为三级，不同级别对应不同的执行策略："));
children.push(table([1600, 3000, 4760], ["级别", "操作示例", "默认策略"], [
  ["L1 安全", "列目录、读文件、搜索、打开网址", "免确认，仅记录日志"],
  ["L2 敏感", "移动 / 重命名 / 删除文件、批量操作", "逐次弹窗确认；可按会话临时授权"],
  ["L3 高危", "执行 shell 命令 / 脚本、修改系统设置", "强制确认 + 展示完整命令；黑名单直接拦截"],
]));
children.push(p("用户可在设置中调整每一级的策略（更严或更松），但 L3 的黑名单不可关闭。"));
children.push(h2("6.3 操作确认机制"));
children.push(bul("敏感操作执行前，由桌宠弹出确认卡片，清楚列出：要做什么、影响哪些文件 / 执行什么命令、是否可撤销；"));
children.push(bul("提供“允许一次 / 本次会话内允许同类 / 拒绝”三个选项；"));
children.push(bul("批量操作展示完整变更清单，支持逐项勾选；"));
children.push(bul("提供全局“只读模式”开关，一键禁用所有写操作与命令执行。"));
children.push(h2("6.4 审计日志"));
children.push(bul("记录每一次工具调用：时间、操作、参数、触发的对话、结果、是否用户确认；"));
children.push(bul("用户可随时在设置中查看、搜索、导出；"));
children.push(bul("写操作尽量保留可回滚信息（如移动前的原路径）。"));
children.push(h2("6.5 高危命令黑名单（示例）"));
children.push(bul("递归强删根目录 / 系统目录类命令；"));
children.push(bul("磁盘格式化、分区操作；"));
children.push(bul("管道执行远程脚本（curl/wget 直接 | sh）；"));
children.push(bul("修改系统关键权限 / 用户账户类命令；"));
children.push(bul("命中黑名单时一律拦截，不提供“仍然执行”的快捷选项，需用户手动到终端自行操作。"));
children.push(h2("6.6 架构层面的安全"));
children.push(bul("渲染进程开启 contextIsolation、关闭 nodeIntegration，绝不直连系统 API；"));
children.push(bul("Preload 只暴露白名单化的 IPC 通道；"));
children.push(bul("敏感能力只在主进程执行，并集中走安全网关；"));
children.push(bul("针对提示注入：对“文件 / 网页内容”与“用户指令”做来源隔离，外部内容不得直接触发 L2/L3 操作；"));
children.push(bul("隐私：上传云端模型前提示用户；提供本地模型选项；可配置目录黑名单（如密码、密钥目录永不读取）。"));

// 7
children.push(h1("七、交互与 UX 设计"));
children.push(h2("7.1 桌宠形态"));
children.push(p("默认一个体型小巧、表情丰富的卡通角色，停在屏幕边角。通过表情和动作传达状态：思考时挠头、执行任务时忙碌、完成时比心、等待确认时举牌。"));
children.push(h2("7.2 对话方式"));
children.push(bul("单击桌宠或按全局快捷键，呼出贴近角色的输入框；"));
children.push(bul("AI 回复以对话气泡形式显示在角色旁，长回复可展开为面板；"));
children.push(bul("执行任务时气泡实时显示“正在 xxx”进度。"));
children.push(h2("7.3 菜单与设置"));
children.push(bul("右键菜单：对话、查看审计日志、只读模式开关、暂停巡游、设置、退出；"));
children.push(bul("设置页：角色 / 皮肤、快捷键、AI 模型与密钥、权限分级策略、目录黑名单。"));

// 8
children.push(h1("八、技术难点与解决方案"));
children.push(table([3000, 6360], ["难点", "解决方案"], [
  ["透明 + 置顶 + 点击穿透并存", "transparent/frame:false/alwaysOnTop 组合；用 setIgnoreMouseEvents(true,{forward:true}) 配合像素级命中检测动态切换穿透"],
  ["跨平台差异", "系统能力封装为统一接口，按平台分别实现；优先保证 macOS，再适配 Windows/Linux"],
  ["AI 流式响应与 UI 同步", "主进程流式拉取 → 通过 IPC 分片推送 → 渲染进程增量渲染气泡"],
  ["Agent 多步任务可靠性", "工具调用结构化（JSON Schema）+ 每步结果回灌 + 失败重试与中止机制"],
  ["安全与易用的平衡", "权限分级 + 会话级临时授权 + 只读模式，既不频繁打扰也不失控"],
  ["性能与资源占用", "休眠态降帧；动画用 GPU 合成；空闲释放资源"],
]));

// 9
children.push(h1("九、开发路线图"));
children.push(table([1400, 2200, 4160, 1600], ["里程碑", "阶段", "交付内容", "预估"], [
  ["M0", "脚手架", "Electron+TS+React 工程搭建、IPC 通道、打包流程跑通", "1 周"],
  ["M1", "桌宠 + 对话", "透明窗口、基础动画、拖拽、AI 流式对话打通", "2-3 周"],
  ["M2", "文件能力 + 安全", "文件读写模块、安全网关、权限分级、确认机制、审计日志", "2-3 周"],
  ["M3", "命令 + Agent 编排", "命令执行模块、黑名单、Agent 多步工具编排", "2-3 周"],
  ["M4", "增强与打磨", "长期记忆、定时任务、换肤、跨平台适配、稳定性优化", "3-4 周"],
]));
children.push(p("建议先完成 M0-M2 形成一个“可对话、能安全操作文件”的可用版本，再视反馈推进 M3-M4。"));

// 10
children.push(h1("十、项目目录结构（建议）"));
children.push(p("desktop-pet/"));
children.push(bul("src/main/ —— 主进程：Agent 引擎、安全网关、文件 / 命令模块、持久化"));
children.push(bul2("agent/ —— 对话管理、工具注册表、规划执行循环"));
children.push(bul2("security/ —— 权限分级、确认、黑名单、审计"));
children.push(bul2("tools/ —— file 模块、command 模块、app 模块"));
children.push(bul2("store/ —— SQLite、配置读写"));
children.push(bul("src/preload/ —— contextBridge 暴露的白名单 IPC"));
children.push(bul("src/renderer/ —— 渲染进程：桌宠角色、动画状态机、对话 UI、设置页"));
children.push(bul2("pet/ —— 角色渲染与动画"));
children.push(bul2("ui/ —— 对话气泡、菜单、设置面板"));
children.push(bul("assets/ —— 角色素材、Lottie 动画、图标"));
children.push(bul("electron-builder.yml —— 打包配置"));

// 11
children.push(h1("十一、风险与注意事项"));
children.push(bul("安全是底线：任何为了“方便”而绕过确认 / 黑名单的设计都应被拒绝；"));
children.push(bul("AI 不可全信：Agent 的规划可能出错，关键写操作必须由用户把关；"));
children.push(bul("合规与隐私：明确告知用户哪些数据会上云，提供本地模型与目录黑名单；"));
children.push(bul("不做恶意能力：本产品定位为本机助手，不应包含任何远程控制他人电脑、隐蔽运行、规避用户感知的能力；"));
children.push(bul("性能体验：桌宠常驻，必须严格控制 CPU / 内存占用，避免成为负担；"));
children.push(bul("渐进交付：先做小而安全的可用版本，再逐步扩展能力。"));

children.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "—— 文档结束 ——", italics: true, color: "808080" })] }));

// ---------- document ----------
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
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 880, hanging: 280 } } } },
      ] },
    ],
  },
  features: { updateFields: true },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
    },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "智能桌宠助手 DeskPet — 方案设计文档", size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "第 ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
        new TextRun({ text: " 页", size: 16, color: "999999" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.argv[2], buf);
  console.log("written:", process.argv[2]);
});
