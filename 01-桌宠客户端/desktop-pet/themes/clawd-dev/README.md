# clawd-dev 主题包

DeskPet 默认像素角色（Clawd，像素螃蟹）的全套动画 / 静态素材.

## 授权

本目录素材**已获授权**纳入 DeskPet 仓库：

- **作者**: [rullerzhou-afk](https://github.com/rullerzhou-afk) — `clawd-on-desk` 项目作者
- **角色 IP**: Clawd（Anthropic 像素螃蟹形象）已通过中间方获得使用授权
- **使用范围**: **非商业用途**（personal / portfolio / 教育 / 研究均可，商业产品需另行联系作者）
- **必须**: GitHub 仓库 README 顶部及 in-app About 显著注明作者出处
- **不可**: 二次分发素材自身、衍生商业化、声称原创

授权获得日期：2026-05-20。

> **历史说明**：v0.4.1 及之前的 release 在素材进 git 前由本机手动 build 上传，
> 未在 binary 内显著标注作者出处 —— 那部分构成历史遗留瑕疵，本次入库
> 之后所有 v0.4.2+ release 都会带正确 attribution.

## 文件清单

65 张 SVG / GIF, 覆盖：
- **基础状态**: idle / sleep / yawn / collapse / thinking / happy / error
- **活动语义** (M3-3 fast-path 触发的视觉)：building / debugger / reading / carrying / conducting / juggling / sweeping / headphones-groove
- **mini 模式** (M9-5 极简化收边)：mini-idle / mini-alert / mini-crabwalk / mini-enter
- **互动反应** (M9-2 click reactions)：poked / startled / wake
- **about-hero**: Settings 头图

## 怎么扩展

加新角色 / 主题：建另一个目录 `themes/your-theme/`，按本目录结构提供同名 SVG/GIF，
然后改 `src/renderer/src/App.tsx` 的 import 路径。`@themes` alias 在
`electron.vite.config.ts` 配的，多主题切换将来走 M1 protocol handler 方案
（theme://idle.svg）。
