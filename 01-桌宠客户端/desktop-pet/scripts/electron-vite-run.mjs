#!/usr/bin/env node
/**
 * Run electron-vite with ELECTRON_RUN_AS_NODE stripped from the child env.
 * Cursor / some IDE terminals set ELECTRON_RUN_AS_NODE=1 globally; inherited
 * spawn makes Electron behave as plain Node → require('electron').app is undefined
 * → @electron-toolkit/utils crashes on isPackaged at import time.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronViteBin = join(
  dirname(require.resolve('electron-vite/package.json')),
  'bin/electron-vite.js'
)

const [, , command, ...args] = process.argv
if (!command) {
  console.error('Usage: node scripts/electron-vite-run.mjs <dev|preview> [...args]')
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [electronViteBin, command, ...args], {
  stdio: 'inherit',
  env
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
