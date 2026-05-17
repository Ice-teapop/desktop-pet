/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// M9-4 spike: `import { ReactComponent } from 'foo.svg?react'` 返回 React 组件。
// 跟 vite-plugin-svgr/client 内置类型一致，这里只是显式 reference。
