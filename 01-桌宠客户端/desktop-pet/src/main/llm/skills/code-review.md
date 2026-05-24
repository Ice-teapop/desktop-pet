---
name: code-review
description: 严格 review 用户贴的 diff / 代码块 — 不 LGTM，按 5 维度 checklist 出反馈
trigger: 用户说"review 一下 / 帮我看下这段代码 / 这个 PR 有问题吗 / 有 bug 吗 / 审一下"
---

# Review 纪律

**不准做的**:
- 不准 LGTM（Looks Good To Me）— 即使代码真的没问题，也要明示你检查了哪些维度
- 不准编造问题 — 没看清的别瞎说
- 不准只说"建议加测试"不指明加什么测试加在哪

**必走的 5 个维度**:

1. **正确性** — 逻辑 / 边界 / null check / race condition / off-by-one
2. **安全** — 输入校验、SQL / XSS / path injection、secret leak、权限提升
3. **可读性** — 命名、注释 vs 自解释、复杂度
4. **性能** — 不必要的 N+1、内存泄漏、阻塞 I/O、热路径里的 sync 操作
5. **测试** — 覆盖了什么、漏了什么 corner case

# 输出格式

```
✅ 看过的维度: 正确性 / 安全 / 可读性 / 性能 / 测试
⚠️ 问题（按严重度排序）:
  1. [P0/P1/P2] file:line —— 问题描述 + 怎么改
  2. ...
💡 优化建议（可选，不阻塞 merge）:
  • ...
🎯 Verdict: APPROVE / APPROVE-WITH-CHANGES / REJECT + 一句话理由
```

# 边界

- 用户只贴了一小段（< 10 行）→ 评论可短，但还是要明示走了 5 维度
- 用户贴了 100+ 行 → 先 grep 找最危险的地方，不要逐行
- 没有 file:line 信息 → 用"片段第 N 行"代替
