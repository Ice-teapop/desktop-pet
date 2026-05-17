import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // M0.5 临时：让渲染层能 import themes/ 下的 SVG。
        // M1 改走 Electron protocol handler（theme://idle.svg），更干净。
        '@themes': resolve('themes')
      }
    },
    server: {
      fs: {
        // Vite dev server root 默认在 src/renderer/，themes/ 在父目录需放行。
        allow: [resolve('.')]
      }
    },
    plugins: [
      react(),
      // M9-4 spike: 让 `import { ReactComponent } from 'foo.svg?react'` 返回
      // inline SVG React 组件 —— renderer 能 ref `<g id="eyes-js">` 之类直接
      // 改 style.transform 实现 eye tracking。
      // include: '**/*.svg?react' 只处理带 ?react query 的 import；其它路径
      // `import url from 'foo.svg'` 仍返回 URL string（dual-img cross-fade 用）
      svgr({
        include: '**/*.svg?react'
      })
    ]
  }
})
