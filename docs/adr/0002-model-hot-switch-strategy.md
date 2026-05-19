# ADR-0002: 模型热切换策略（软切 vs 硬切）

- **状态**: Accepted
- **日期**: 2026-05-18
- **决策者**: @han (A=a / B=b1) + planner + architect + 2 reviewers + cc

## 背景

v0.4.0 之前用户在对话中途切模型有三个症状：

1. 同 provider 内换模型也会打断当前流式响应
2. pill 和 Settings 显示不一致（见 [ADR-0001](0001-selected-model-single-source-of-truth.md)）
3. 跨 provider 换模型直接清历史但没告知用户，对话像"消失了"

## 决策

**两档策略**：

| 条件 | 策略 | 用户体验 |
|---|---|---|
| 同 provider + 同 tool capability | **软切（soft switch）** | 旧响应跑完不打断，下条用户消息开始用新模型 |
| 跨 provider，或 tool capability 不同 | **硬切（hard switch）** | abort 当前流 + 清历史 + 系统气泡告知 `(已切到 xxx)` |

实现要点（`src/main/index.ts` `selected-model:set` handler）：

- **软切**：不 abort，不 `++chatTurnToken`，不 pop trailing user message
- **硬切**：abort + `++chatTurnToken` + 清 messages + 推 `chat:history-cleared` 带 `reason: 'provider-switch'` + renderer 加系统气泡

用户决策点：
- **A=a**：旧响应跑完不打断（vs A=b 立即 abort）
- **B=b1**：直接清 + 气泡告知（vs B=b2 软归档可切回）

## 备选方案

**A=b（立即 abort 旧响应）**
否决理由：用户已经在看的内容被砍掉很反感；软切的"轻接"心智更接近"换挡"。

**B=b2（历史按 provider 软归档，可切回看）**
否决理由：增加 archive 数据结构 + UI（archived chats 列表）+ 切回交互。复杂度跟需求强度不匹配，先 b1 看用户痛不痛。
归档方案保留为未来选项（见 deferred 列表）。

## 后果

**正面**：
- 同模型族内（如 sonnet → opus）切换无感知，符合"用户视角就是换个脑子"
- 跨 provider 有明确"换人了"的视觉信号，不再丢消息感

**负面 / 待办**：
- 软切下旧响应用旧模型回完才结束，用户如果**指望新模型立刻回应**会困惑 → 当前没解，靠"软切只在同 provider"约束减轻
- B=b1 清历史不可逆 — 用户切到错的 provider 想切回去之前的聊天找不到了
- 没有"切换中"过渡 UI（架构师建议的 `switchingTo` 字段 + `selected-model:rejected` channel 没做），rejected 场景静默

**警惕**：
- 新增 provider 时要确认 tool capability 分类（带 native tools 的 / 不带的），分类错会导致本该硬切的被判软切，工具调用会失败
