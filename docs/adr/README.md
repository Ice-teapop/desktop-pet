# Architecture Decision Records

每个有"为什么这么干"价值的决策落一个 ADR。模板：

```md
# ADR-NNNN: 短标题

- **状态**: Proposed / Accepted / Superseded by ADR-XXXX / Deprecated
- **日期**: YYYY-MM-DD
- **决策者**: @user / 哪个 agent 拍板

## 背景
触发这个决策的问题、约束、痛点。

## 决策
最终选了什么方案。一句话能说清就一句话。

## 备选方案
还讨论过哪些，为什么没选。

## 后果
落地后会带来什么（正面 + 负面），后续要警惕什么。
```

## 索引

| # | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-selected-model-single-source-of-truth.md) | selected-model 单一事实来源 | Accepted | 2026-05-18 |
| [0002](0002-model-hot-switch-strategy.md) | 模型热切换策略（软切 vs 硬切） | Accepted | 2026-05-18 |
