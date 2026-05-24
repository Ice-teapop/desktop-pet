# ⚠️ 此模块已弃用（DEPRECATED）

## 状态

**`03-非LLM视觉服务/`（含 `vision-service/` Python FastAPI + 全部设计 docx + 生成脚本）已不在 active 开发轨道上。**

## 弃用时间点

CHANGELOG 中 **M4-A vision pivot** 节点（早期 v0.0.x 阶段）。

## 弃用原因

原架构计划用一个独立的 **非 LLM 视觉服务**（自托管 Python FastAPI + OCR / 表格 / 公式转码管道）做屏幕识别，桌宠通过 HTTP IPC 喂截图过来。

M4-A 阶段评估后改路（pivot）成：**直接走当前选中 LLM provider 的 vision endpoint**（截屏 base64 → 当前 LLM 模型的 vision 接口），即 `view_screen` agentic tool。

参见根目录 `README.md` "Agentic vision" 段以及 `01-桌宠客户端/desktop-pet/src/main/services/screen-capture.ts` + `vision-pipeline.ts` 实装。

## 保留它做什么

- 设计文档（`*.docx` + `*-生成脚本.js`）保留作为历史参考与 ADR 上下文
- `vision-service/` Python 代码保留作为后续若需要"自托管视觉路径"的起点（当前无开发计划）

## 不要做什么

- 不要在此目录新增功能 / 修 bug
- 不要把 client（`01-桌宠客户端/`）的 vision 调用接回这里 — client 当前只走 LLM provider vision endpoint
- 不要把这个目录当作架构示例来读 — 实际架构看 `01-桌宠客户端/desktop-pet/src/main/services/`

## 何时可以彻底删除

由仓库 owner 决定。删除前确认：
1. `git log -- 03-非LLM视觉服务/` 没有近期活动
2. 没有外部文档（issue / blog / talk）链向此目录
3. 设计 docx 已迁移到 `docs/adr/` 或归档到独立 archive 分支

---

*文件作用：onboarding 时让人立刻识别这是死代码，避免误读为 active 模块。*
