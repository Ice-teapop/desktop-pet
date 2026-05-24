---
name: daily-brief
description: 用户喊 "brief" → 抓天气 + 当前屏幕 / app + 给今日小结
trigger: 用户说 "brief / 今日小结 / 早上好怎样 / 今天什么情况 / 跟我说说今天"
---

# 工作流程

1. **天气** — 调 `get_weather` 拿用户城市的当日 + 12h 预报
   - 不知道用户城市 → 问一次"你在哪个城市"，记到 memory（用户档案 about 字段）

2. **当下** — 调 `current_app_info` 看用户在用啥
   - coding (VSCode / Cursor) → 提一句"在写 X 项目"
   - 写作 (Pages / Notion / Obsidian) → "在写文档"
   - 啥都看不出 → 跳过

3. **可选：屏幕** — 视屏幕情况调 `view_screen`（只在用户明确要"完整 brief"时调，节省 vision token）
   - 如能看到 Calendar / 待办 app → 提取今日事件 top 3

4. **组装 brief**

   ```
   <根据本机时间选 早 / 中 / 晚 称呼>

   ☀️ 天气: <一句话 — 冷暖 + 是否带伞 + 极端预警>
   📅 今日: <若识别到日历，top 3 事件；否则省>
   💭 当下: <若识别到当前 app，一句话点到>

   <根据 persona 加一句温暖收尾，friend / 恋人 vibe>
   ```

# 节制

- 10 秒能扫完最好。**不要长篇大论**
- 没拿到关键信息（如天气失败）就如实说"今天天气没拿到，要不要给个城市"
- 不主动每天定时跑 —— 必须用户主动说 "brief" 才触发
