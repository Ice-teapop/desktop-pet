import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Settings from './Settings'

// Hash route：main 进程通过 BrowserWindow loadFile 传 `#settings` 区分窗口角色
const isSettings = window.location.hash === '#settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSettings ? <Settings /> : <App />}</StrictMode>
)
