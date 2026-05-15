# clawd-dev 主题包 — 开发期素材占位

本目录**不进 git**（除本 README 与 `.gitignore` 之外的所有文件被忽略）。

## 为什么不进 git

`clawd-on-desk` 的源仓库 LICENSE 是 **AGPL-3.0**（虽然 README 写"MIT"，
但 LICENSE 文件才是法律事实）。AGPL 是强 copyleft，且 Clawd（像素螃蟹）
角色形象的 IP 归属 Anthropic（clawd-on-desk 自述非官方社区作品）。

如果把 clawd 素材直接 commit 到 DeskPet 仓库 + push 到 GitHub，
即构成 AGPL 协议下的"分发"，整个 DeskPet 会被 AGPL 传染。
所以**素材开发期本地用，永不入库**；发布前替换为原创角色美术。

## 怎么拿到素材

```bash
# 1. 把 clawd-on-desk 浅克隆到任意临时位置
git clone --depth 1 https://github.com/rullerzhou-afk/clawd-on-desk.git /tmp/clawd-source

# 2. 把 SVG 资源复制到本目录
cp /tmp/clawd-source/assets/svg/*.svg ./

# 3. 把 clawd 主题描述放过来当 manifest 参考
cp /tmp/clawd-source/themes/clawd/theme.json ./

# 4. 清掉临时仓库
rm -rf /tmp/clawd-source
```

之后渲染层按本目录的 `theme.json` 加载状态映射的 SVG。

## 主方案对应章节

- 《桌宠动画引擎与状态机》第二章「资源方案：复用 clawd-on-desk」
- 第 2.2 节「授权与合规说明（重要）」
- 第 2.3 节「主题包架构」
