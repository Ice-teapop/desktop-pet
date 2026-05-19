# ADR-0001: selected-model 单一事实来源

- **状态**: Accepted
- **日期**: 2026-05-18
- **决策者**: @han + planner + architect + 2 reviewers

## 背景

v0.4.0 之前同时存在两套 model state 推送路径：

1. `prefs:set-model` IPC + `prefs:state.modelId` 字段 — 设置面板用
2. `selected-model:set` IPC + `selected-model:state` 推送 — pill / tray 用

两条路径各自更新各自的内存值，没有强同步。结果就是：tray 菜单点切换后 `currentSelectedModel` 改了但 `prefs.modelId` 没改，Settings 打开看到旧值，pill 又显示新值，**用户看到 pill 跟 Settings 对不上**（症状 2）。

另外审计还发现 `setModel()` 改完内存忘了广播 `selected-model:state`，pill 也跟着 stale。

## 决策

**selected-model 走专用 channel，prefs 不再 mirror。**

具体执行：

- `PrefsState` 删 `modelId` 字段（`src/shared/settings-types.ts`）
- 删 `prefs:set-model` IPC handler
- 删 preload `setModel` API + `ModelId` import
- 删 `prefsSnapshot()` 返回里的 `modelId`
- `setModel()` 加上漏掉的 `broadcastSelectedModelState()` 调用
- `preferences.json` 留 `currentModel` 字段做 schema 锚（暂不删，避免老用户配置文件迁移）

## 备选方案

**A. 双向同步 prefs:state.modelId ↔ selected-model:state**
否决理由：增加同步代码 + race window，治标不治本。冗余字段本身就是 bug 温床。

**B. 全部走 prefs，废 selected-model:state**
否决理由：tray / pill 已经直接订阅 selected-model:state，迁回 prefs 改动面更大；且 selected-model 是"运行时强类型元组"，跟 prefs 的"偏好持久化"语义不同。

## 后果

**正面**：
- pill / Settings / tray 三处读同一份内存值，不会再不一致
- 新增 model UI 不用想"要不要同时推 prefs"

**负面 / 待办**：
- `preferences.json` 留了 `currentModel` 字段没用 — 未来某次配置 schema 迁移要清掉
- 老版本（< 0.4.0）的 preferences.json 里有 `modelId` 字段会被忽略 — 用户首次启动 0.4.0 会回到默认模型选择，可接受

**警惕**：
- 任何新加的"跟模型有关"的 state 都要走 `selected-model:state`，不要 PR 时图省事塞回 prefs
