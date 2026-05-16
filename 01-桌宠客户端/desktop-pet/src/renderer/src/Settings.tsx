/**
 * 设置面板（M5）—— 独立 BrowserWindow（hash=#settings 路由进入）。
 *
 * 单一事实来源在 main 进程；这里订阅 5 个 state stream（key / vision / tavily /
 * prefs / trusted-dirs），任何变更通过 IPC 推给 main 再广播回所有 webContents。
 * 不读取 / 不缓存任何 key 实际值 —— 仅 "configured / not"。
 */
import { useEffect, useState } from 'react'
import { AVAILABLE_MODELS } from '../../shared/chat-types'
import type { KeyState, ModelId } from '../../shared/chat-types'
import type { VisionState } from '../../shared/vision-types'
import type { TavilyState } from '../../shared/tavily-types'
import type { PrefsState, TrustedDirsState } from '../../shared/settings-types'
import './assets/settings.css'

function Settings(): React.JSX.Element {
  // —— State 订阅 ——
  const [keyState, setKeyState] = useState<KeyState | null>(null)
  const [tavilyState, setTavilyState] = useState<TavilyState | null>(null)
  const [visionState, setVisionState] = useState<VisionState | null>(null)
  const [prefs, setPrefs] = useState<PrefsState | null>(null)
  const [trustedDirs, setTrustedDirs] = useState<TrustedDirsState | null>(null)

  // —— Tavily 输入 modal ——
  const [tavilyModalOpen, setTavilyModalOpen] = useState(false)
  const [tavilyKeyDraft, setTavilyKeyDraft] = useState('')

  // —— Toast 状态（操作反馈） ——
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200)
  }

  useEffect(() => {
    const offKey = window.api.onKeyState((s) => setKeyState(s))
    const offTavily = window.api.onTavilyState((s) => setTavilyState(s))
    const offVision = window.api.onVisionState((s) => setVisionState(s))
    const offPrefs = window.api.onPrefsState((s) => setPrefs(s))
    const offTrusted = window.api.onTrustedDirsState((s) => setTrustedDirs(s))
    window.api.requestKeyState()
    window.api.requestTavilyState()
    window.api.requestVisionState()
    window.api.requestPrefsState()
    window.api.requestTrustedDirsState()
    return () => {
      offKey()
      offTavily()
      offVision()
      offPrefs()
      offTrusted()
    }
  }, [])

  // —— Anthropic key actions ——
  const handleResetAnthropicKey = (): void => {
    window.api.resetKey()
    showToast('已清除 API key，回桌宠对话区粘贴新的')
  }

  // —— Tavily key actions ——
  const handleTavilyOpen = (): void => {
    setTavilyKeyDraft('')
    setTavilyModalOpen(true)
  }
  const handleTavilySubmit = (): void => {
    const trimmed = tavilyKeyDraft.trim()
    if (!trimmed) return
    window.api.submitTavilyKey(trimmed)
    setTavilyModalOpen(false)
    setTavilyKeyDraft('')
    showToast('Tavily key 已加密保存')
  }
  const handleTavilyReset = (): void => {
    window.api.resetTavilyKey()
    setTavilyModalOpen(false)
    showToast('Tavily key 已清除')
  }

  // —— Vision actions ——
  const handleRevokeVision = (): void => {
    window.api.revokeVisionConsent()
    showToast('已撤销屏幕感知 consent')
  }
  const handleToggleVision = (enable: boolean): void => {
    window.api.setVisionEnabled(enable)
  }

  // —— Audit log ——
  const handleRevealAudit = (): void => window.api.revealAuditLogInFinder()
  const handleClearAudit = async (): Promise<void> => {
    const r = await window.api.clearAuditLog()
    showToast(r.ok ? '审计日志已清空' : `清空失败：${r.error}`)
  }

  // —— Trusted dirs ——
  const handleRevokePersistent = async (dir: string): Promise<void> => {
    const r = await window.api.revokeTrustedDirPersistent(dir)
    showToast(r.ok ? `已撤销永久信任：${dir}` : `撤销失败：${r.error}`)
  }
  const handleRevokeAllSession = (): void => {
    window.api.revokeAllSessionTrustedDirs()
    showToast('会话信任目录已清空')
  }

  // —— Prefs setters ——
  const handleSetModel = (modelId: ModelId): void => window.api.setModel(modelId)
  const handleSetFollow = (v: boolean): void => window.api.setFollowFrontApp(v)
  const handleSetFastPath = (v: boolean): void => window.api.setUseFastPath(v)

  // —— Render ——
  return (
    <div className="settings-app">
      <h1>DeskPet 设置</h1>

      {/* —— 1. API Keys —— */}
      <section>
        <h2>API Keys</h2>
        <div className="row">
          <label>Anthropic（对话引擎，必需）</label>
          <span className={`badge ${keyState === 'ready' ? 'badge-ok' : 'badge-warn'}`}>
            {keyState === 'ready' ? '已配置' : keyState === 'missing' ? '未配置' : '...'}
          </span>
          <button onClick={handleResetAnthropicKey} disabled={keyState !== 'ready'}>
            重设 / 清除
          </button>
        </div>
        <div className="row">
          <label>Tavily 搜索（可选 —— AI 联网）</label>
          <span className={`badge ${tavilyState?.kind === 'configured' ? 'badge-ok' : 'badge-muted'}`}>
            {tavilyState?.kind === 'configured' ? '已配置' : '未配置'}
          </span>
          <button onClick={handleTavilyOpen}>
            {tavilyState?.kind === 'configured' ? '重设 / 清除' : '设置'}
          </button>
        </div>
        <p className="hint">
          所有 key 都用 Electron safeStorage（macOS Keychain backed AES-256）加密落盘，
          不上传任何位置。
        </p>
      </section>

      {/* —— 2. Pet Behavior —— */}
      <section>
        <h2>桌宠行为</h2>
        <div className="row">
          <label>对话模型</label>
          <div className="model-radios">
            {AVAILABLE_MODELS.map((m) => (
              <label key={m.id} className="radio-item">
                <input
                  type="radio"
                  name="model"
                  checked={prefs?.modelId === m.id}
                  onChange={() => handleSetModel(m.id)}
                  disabled={!prefs}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={prefs?.followFrontApp ?? false}
              onChange={(e) => handleSetFollow(e.target.checked)}
              disabled={!prefs}
            />
            <span>跟随前台 App 自动识别活动状态</span>
          </label>
        </div>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={!(prefs?.useFastPath ?? true)}
              onChange={(e) => handleSetFastPath(!e.target.checked)}
              disabled={!prefs || !prefs.followFrontApp}
            />
            <span>严格 LLM 识别（关 fast-path bundleID 白名单）</span>
          </label>
        </div>
      </section>

      {/* —— 3. Agentic Tools —— */}
      <section>
        <h2>Agentic 工具（M4）</h2>
        <div className="row">
          <label>屏幕感知 + 全部 tools</label>
          <span
            className={`badge ${
              visionState?.kind === 'enabled'
                ? 'badge-ok'
                : visionState?.kind === 'disabled'
                  ? 'badge-muted'
                  : 'badge-warn'
            }`}
          >
            {visionState?.kind === 'enabled'
              ? '启用中'
              : visionState?.kind === 'disabled'
                ? '已 consent 但 toggle 关'
                : '未 consent'}
          </span>
        </div>
        {visionState?.kind === 'disabled-no-consent' && (
          <p className="hint">回桌宠对话区点「🔒 启用屏幕感知」按钮走 consent 流程。</p>
        )}
        {visionState?.kind === 'disabled' && (
          <div className="row">
            <button onClick={() => handleToggleVision(true)}>启用</button>
            <button onClick={handleRevokeVision} className="danger">
              撤销 consent
            </button>
          </div>
        )}
        {visionState?.kind === 'enabled' && (
          <div className="row">
            <button onClick={() => handleToggleVision(false)}>关闭</button>
            <button onClick={handleRevokeVision} className="danger">
              撤销 consent
            </button>
          </div>
        )}
        <details className="tool-list-details">
          <summary>当前 AI 可用工具（共 16 个）</summary>
          <ul className="tool-list">
            <li>
              <b>view_screen</b> / read_clipboard / current_app_info —— 上下文采集
            </li>
            <li>
              <b>open_url</b> / copy_to_clipboard —— 浏览器 + 剪贴板
            </li>
            <li>
              <b>read_file</b> / list_directory / find_files —— 文件读取
            </li>
            <li>
              <b>write_file</b> / create_directory / delete_file —— 文件写入（delete 必弹审批）
            </li>
            <li>
              <b>run_command</b> —— shell 命令（safe 白名单静默 / 其它弹审批 / 危险命令永拒）
            </li>
            <li>
              <b>open_system_settings</b> / read_system_preference —— 系统设置
            </li>
            <li>
              <b>fetch_url</b> / web_search —— 网络
            </li>
          </ul>
        </details>
      </section>

      {/* —— 4. Trust & Audit —— */}
      <section>
        <h2>信任目录 + 审计日志</h2>
        <div className="row">
          <label>永久信任目录（持久化）</label>
        </div>
        {trustedDirs && trustedDirs.persistent.length > 0 ? (
          <ul className="dir-list">
            {trustedDirs.persistent.map((d) => (
              <li key={d}>
                <code>{d}</code>
                <button className="small danger" onClick={() => handleRevokePersistent(d)}>
                  撤销
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">（无 —— 用户在审批 modal 上点「永久信任」后会出现在这里）</p>
        )}
        <div className="row">
          <label>本会话信任目录</label>
          <span className="badge badge-muted">
            {trustedDirs ? `${trustedDirs.session.length} 个` : '...'}
          </span>
          <button
            onClick={handleRevokeAllSession}
            disabled={!trustedDirs || trustedDirs.session.length === 0}
          >
            清空
          </button>
        </div>
        {trustedDirs && trustedDirs.session.length > 0 && (
          <ul className="dir-list compact">
            {trustedDirs.session.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          注：HOME 下 visible 顶级目录（~/Documents 等）默认信任，不在此列表里 ——
          那是基线，不能撤销。
        </p>
        <div className="row">
          <label>审计日志</label>
          <button onClick={handleRevealAudit}>在 Finder 显示</button>
          <button onClick={handleClearAudit} className="danger">
            清空
          </button>
        </div>
        <p className="hint">
          ~/Library/Application Support/DeskPet/audit.log —— JSONL append-only，
          5MB 自动滚动；仅本地，不上传。
        </p>
      </section>

      {/* —— 5. About —— */}
      <section>
        <h2>关于</h2>
        <p>DeskPet 智能桌宠助手 · 透明置顶桌宠 + 多模态 AI</p>
        <p className="hint">
          快捷键：<code>⌘+,</code> 打开本面板 · <code>⌘+⇧+P</code> 显示/隐藏桌宠 · <code>⌘+Q</code> 退出
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}

      {tavilyModalOpen && (
        <div className="settings-modal-overlay" onClick={() => setTavilyModalOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tavily Search API key</h3>
            <p>
              注册：<code>tavily.com</code>，从 Dashboard 拿 <code>tvly-...</code> key。
              免费 1000 次/月。
            </p>
            <input
              type="password"
              placeholder="tvly-xxxxxxxxxxxx"
              value={tavilyKeyDraft}
              onChange={(e) => setTavilyKeyDraft(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button onClick={() => setTavilyModalOpen(false)}>取消</button>
              {tavilyState?.kind === 'configured' && (
                <button onClick={handleTavilyReset} className="danger">
                  清除已存
                </button>
              )}
              <button
                onClick={handleTavilySubmit}
                disabled={!tavilyKeyDraft.trim()}
                className="primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
