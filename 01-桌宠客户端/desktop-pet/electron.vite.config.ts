import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()]
  }
})
