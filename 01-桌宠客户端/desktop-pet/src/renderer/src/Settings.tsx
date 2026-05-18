/**
 * 设置面板（M5 + M7-5 多 provider 改造）—— 独立 BrowserWindow（hash=#settings 路由）。
 *
 * 单一事实来源在 main 进程；这里订阅 7 个 state stream（provider-key / selected-model
 * / vision / tavily / prefs / trusted-dirs / user-profile），任何变更通过 IPC
 * 推给 main 再广播回所有 webContents。
 *
 * 隐私：**不读取 / 不缓存任何 key 实际值** —— 仅订阅 `ProviderKeyStates` boolean map。
 */
import { useEffect, useState } from 'react'
import {
  PROVIDERS,
  PROVIDER_ORDER,
  modelsForProvider,
  defaultModelForProvider,
  type Provider,
  type ProviderKeyStates,
  type SelectedModel
} from '../../shared/provider-types'
import type { VisionState } from '../../shared/vision-types'
import type { TavilyState } from '../../shared/tavily-types'
import type { PrefsState, TrustedDirsState } from '../../shared/settings-types'
import {
  PERSONA_PRESET_LABELS,
  type PersonaPreset,
  type UserProfile
} from '../../shared/user-profile-types'
import './assets/settings.css'

/**
 * 从 keyPattern 正则提取前缀提示，用作 input placeholder。
 * 例：/^sk-ant-[\w-]{20,200}$/ → "sk-ant-..."
 * 没 keyPattern 的 provider（如 Google / ByteDance）→ "paste key"
 */
function placeholderFromKeyPattern(pattern: RegExp | undefined): string {
  if (!pattern) return 'paste key'
  const src = pattern.source
  const match = src.match(/^\^?([\w-]+?)(?:\[|$)/)
  return match ? `${match[1]}...` : 'paste key'
}

function Settings(): React.JSX.Element {
  // —— State 订阅 ——
  const [providerKeyStates, setProviderKeyStates] = useState<ProviderKeyStates | null>(null)
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null)
  const [tavilyState, setTavilyState] = useState<TavilyState | null>(null)
  const [visionState, setVisionState] = useState<VisionState | null>(null)
  const [prefs, setPrefs] = useState<PrefsState | null>(null)
  const [trustedDirs, setTrustedDirs] = useState<TrustedDirsState | null>(null)

  // —— Per-provider inline key 编辑 drafts ——
  // 用 Record<Provider, string> 让 6 个 provider 各自独立 input draft，互不干扰。
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<
    Partial<Record<Provider, string>>
  >({})
  const [tavilyKeyDraft, setTavilyKeyDraft] = useState('')

  // —— M5-2 Memory 编辑 ——
  const [memoryContent, setMemoryContent] = useState<string>('')
  const [memoryDraft, setMemoryDraft] = useState<string>('')
  const [memoryDirty, setMemoryDirty] = useState(false)
  const [memoryLoaded, setMemoryLoaded] = useState(false)

  // —— M5-3 User profile form state ——
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileDirty, setProfileDirty] = useState(false)

  // —— Toast 状态（操作反馈） ——
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200)
  }

  useEffect(() => {
    const offProviderKeyStates = window.api.onProviderKeyStates((s) =>
      setProviderKeyStates(s)
    )
    const offSelectedModel = window.api.onSelectedModelState((s) => setSelectedModel(s))
    const offTavily = window.api.onTavilyState((s) => setTavilyState(s))
    const offVision = window.api.onVisionState((s) => setVisionState(s))
    const offPrefs = window.api.onPrefsState((s) => setPrefs(s))
    const offTrusted = window.api.onTrustedDirsState((s) => setTrustedDirs(s))
    const offProfile = window.api.onUserProfileState((p) => {
      // 服务端 push 进来时，如果 user 没在改（dirty），直接覆盖；改了别打断
      setProfile((cur) => (profileDirty && cur ? cur : p))
    })
    window.api.requestProviderKeyStates()
    window.api.requestSelectedModelState()
    window.api.requestTavilyState()
    window.api.requestVisionState()
    window.api.requestPrefsState()
    window.api.requestTrustedDirsState()
    window.api.requestUserProfileState()
    return () => {
      offProviderKeyStates()
      offSelectedModel()
      offTavily()
      offVision()
      offPrefs()
      offTrusted()
      offProfile()
    }
    // 故意不放 profileDirty 进 deps —— ref-like 用法 + 订阅 effect 不应重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // —— Provider key actions（generic，6 provider 共用） ——
  const updateProviderKeyDraft = (provider: Provider, value: string): void => {
    setProviderKeyDrafts((prev) => ({ ...prev, [provider]: value }))
  }
  const handleProviderSubmit = (provider: Provider): void => {
    const trimmed = (providerKeyDrafts[provider] || '').trim()
    if (!trimmed) return
    window.api.submitProviderKey(provider, trimmed)
    setProviderKeyDrafts((prev) => ({ ...prev, [provider]: '' }))
    showToast(`${PROVIDERS[provider].label} key 已加密保存`)
  }
  const handleProviderReset = (provider: Provider): void => {
    window.api.resetProviderKey(provider)
    setProviderKeyDrafts((prev) => ({ ...prev, [provider]: '' }))
    showToast(`${PROVIDERS[provider].label} key 已清除`)
  }

  // —— Selected model actions ——
  const handleProviderChange = (newProvider: Provider): void => {
    if (!selectedModel || selectedModel.provider === newProvider) return
    const defaultSel = defaultModelForProvider(newProvider)
    window.api.setSelectedModel(defaultSel)
    showToast(`已切到 ${PROVIDERS[newProvider].label}（跨 provider 自动开新对话）`)
  }
  const handleModelChange = (newModelId: string): void => {
    if (!selectedModel || selectedModel.modelId === newModelId) return
    window.api.setSelectedModel({ provider: selectedModel.provider, modelId: newModelId })
  }

  // —— Tavily key actions（inline，单独 card） ——
  const handleTavilySubmit = (): void => {
    const trimmed = tavilyKeyDraft.trim()
    if (!trimmed) return
    window.api.submitTavilyKey(trimmed)
    setTavilyKeyDraft('')
    showToast('Tavily key 已加密保存')
  }
  const handleTavilyReset = (): void => {
    window.api.resetTavilyKey()
    setTavilyKeyDraft('')
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

  // —— M5-2 Memory actions（inline 编辑） ——
  const refreshMemory = async (): Promise<void> => {
    const r = await window.api.readMemory()
    const content = r.ok ? r.content : ''
    setMemoryContent(content)
    setMemoryDraft(content)
    setMemoryDirty(false)
    setMemoryLoaded(true)
  }
  useEffect(() => {
    void refreshMemory()
  }, [])
  const handleMemoryChange = (v: string): void => {
    setMemoryDraft(v)
    setMemoryDirty(v !== memoryContent)
  }
  const handleSaveMemory = async (): Promise<void> => {
    const r = await window.api.saveMemory(memoryDraft)
    if (r.ok) {
      setMemoryContent(memoryDraft)
      setMemoryDirty(false)
      showToast('长期记忆已保存')
    } else {
      showToast(`保存失败：${r.error}`)
    }
  }
  const handleClearMemory = async (): Promise<void> => {
    const r = await window.api.clearMemory()
    if (r.ok) {
      setMemoryContent('')
      setMemoryDraft('')
      setMemoryDirty(false)
      showToast('长期记忆已清空')
    } else {
      showToast(`清空失败：${r.error}`)
    }
  }
  const handleClearChatHistory = async (): Promise<void> => {
    const r = await window.api.clearChatHistory()
    showToast(r.ok ? '对话历史已清空（含桌宠 UI）' : `清空失败：${r.error}`)
  }

  // —— M5-3 profile actions ——
  const updateProfileField = <K extends keyof UserProfile>(
    key: K,
    value: UserProfile[K]
  ): void => {
    if (!profile) return
    setProfile({ ...profile, [key]: value })
    setProfileDirty(true)
  }
  const handleSaveProfile = async (): Promise<void> => {
    if (!profile) return
    const r = await window.api.saveUserProfile(profile)
    if (r.ok) {
      setProfileDirty(false)
      showToast('用户档案已保存')
    } else {
      showToast(`保存失败：${r.error}`)
    }
  }
  const handleResetWizard = async (): Promise<void> => {
    const r = await window.api.resetUserProfileSetup()
    if (r.ok) {
      setProfileDirty(false)
      showToast('已重置 —— 下次对话 AI 会重走 wizard 流程')
    } else {
      showToast(`重置失败：${r.error}`)
    }
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

  // —— Prefs setters（非 model 类，model 走 setSelectedModel） ——
  const handleSetFollow = (v: boolean): void => window.api.setFollowFrontApp(v)
  const handleSetFastPath = (v: boolean): void => window.api.setUseFastPath(v)

  // —— Render ——
  return (
    <div className="settings-app">
      <h1>DeskPet 设置</h1>

      {/* —— 1. API Keys (M7-5 multi-provider) —— */}
      <section>
        <h2>AI 引擎</h2>
        <p className="hint">
          配 key + 切当前对话用哪家. 至少配一个让桌宠开口. Key 用 Electron safeStorage
          (macOS Keychain backed AES-256) 加密落盘, 绝不上传.
        </p>

        {PROVIDER_ORDER.map((providerId) => {
          const info = PROVIDERS[providerId]
          const configured = providerKeyStates?.[providerId] ?? false
          const draft = providerKeyDrafts[providerId] || ''
          const isActive = configured && selectedModel?.provider === providerId
          const state = isActive
            ? 'active'
            : configured
              ? 'configured'
              : 'unconfigured'
          return (
            <div
              key={providerId}
              className={`provider-card provider-card--${state}`}
            >
              <div className="row provider-card-header">
                <label>
                  {isActive && <span className="chip-current">● 当前使用</span>}
                  {info.label}
                </label>
                {configured && !isActive && (
                  <button
                    className="btn-switch-provider"
                    onClick={() => handleProviderChange(providerId)}
                  >
                    切换到此 →
                  </button>
                )}
                {!configured && (
                  <span className="badge badge-muted">未配置</span>
                )}
              </div>
              <p className="hint">{info.description}</p>

              {/* Model dropdown — 仅 active 时展开 (避免 6 个卡都展开噪音) */}
              {isActive && selectedModel && (
                <div className="row">
                  <label>当前模型</label>
                  <select
                    value={selectedModel.modelId}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="profile-input"
                  >
                    {modelsForProvider(providerId).map((m) => {
                      const tags: string[] = []
                      if (m.isReasoning) tags.push('推理')
                      if (!m.supportsTools) tags.push('无 tool')
                      if (!m.supportsVision) tags.push('无 vision')
                      return (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {tags.length > 0 ? `(${tags.join(' / ')})` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              <div className="row">
                <input
                  type="password"
                  className="profile-input"
                  placeholder={
                    configured
                      ? '粘贴新 key 覆盖（留空不动）'
                      : placeholderFromKeyPattern(info.keyPattern)
                  }
                  value={draft}
                  onChange={(e) => updateProviderKeyDraft(providerId, e.target.value)}
                />
                <button
                  onClick={() => handleProviderSubmit(providerId)}
                  disabled={!draft.trim()}
                  className="primary"
                >
                  保存
                </button>
                <button
                  onClick={() => handleProviderReset(providerId)}
                  disabled={!configured}
                  className="danger"
                >
                  清除
                </button>
              </div>
              <p className="hint">
                注册：<code>{info.registrationUrl}</code>
              </p>
              {isActive && (
                <p className="hint provider-fallback-hint">
                  ⓘ 当前 provider 过载时自动 fallback 到其它已配 provider 继续对话.
                  切换 provider = 新对话开始 (跨家历史不兼容).
                </p>
              )}
            </div>
          )
        })}
        {!selectedModel && (
          <p className="hint" style={{ marginTop: 12 }}>
            加载 provider/model 状态中...
          </p>
        )}

        {/* —— Tavily 联网搜索（不是 LLM provider，单独 card） —— */}
        <div className="provider-card" style={{ marginTop: 16 }}>
          <div className="row">
            <label>Tavily 联网搜索（可选）</label>
            <span
              className={`badge ${tavilyState?.kind === 'configured' ? 'badge-ok' : 'badge-muted'}`}
            >
              {tavilyState?.kind === 'configured' ? '已配置' : '未配置'}
            </span>
          </div>
          <p className="hint">
            设了之后 AI 可调 web_search tool 联网查询（免费 1000 次/月）。隐私：
            query 发 api.tavily.com。
          </p>
          <div className="row">
            <input
              type="password"
              className="profile-input"
              placeholder={
                tavilyState?.kind === 'configured'
                  ? '粘贴新 key 覆盖（留空不动）'
                  : 'tvly-...'
              }
              value={tavilyKeyDraft}
              onChange={(e) => setTavilyKeyDraft(e.target.value)}
            />
            <button
              onClick={handleTavilySubmit}
              disabled={!tavilyKeyDraft.trim()}
              className="primary"
            >
              保存
            </button>
            <button
              onClick={handleTavilyReset}
              disabled={tavilyState?.kind !== 'configured'}
              className="danger"
            >
              清除
            </button>
          </div>
          <p className="hint">
            注册：<code>tavily.com</code>
          </p>
        </div>
      </section>

      {/* —— 2. 识别 / 自动化 (provider + model cascade 已搬到 section 1 卡片) —— */}
      <section>
        <h2>识别 / 自动化</h2>
        <p className="hint">
          桌宠通过观察前台 App 自动识别你在干啥 (写代码 / 写文档 / 聊天 / 听音乐).
          活动分类用 Anthropic Claude Haiku 4.5 hardcoded (cost/speed 最优), 不
          跟随上面 provider 选择切换.
        </p>

        <div className="row" style={{ marginTop: 14 }}>
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

      {/* —— 5. 用户档案（M5-3） —— */}
      <section>
        <h2>用户档案</h2>
        {profile ? (
          <>
            <div className="row">
              <label>状态</label>
              <span
                className={`badge ${profile.setupCompleted ? 'badge-ok' : 'badge-warn'}`}
              >
                {profile.setupCompleted ? '已设置' : '未设置（下次对话 AI 会走 wizard）'}
              </span>
            </div>
            <div className="row">
              <label>称呼</label>
              <input
                type="text"
                className="profile-input"
                value={profile.name}
                onChange={(e) => updateProfileField('name', e.target.value)}
                placeholder="（如 Han）"
              />
            </div>
            <div className="row">
              <label>关于你</label>
              <textarea
                className="profile-textarea"
                value={profile.about}
                onChange={(e) => updateProfileField('about', e.target.value)}
                placeholder="（工作 / 项目 / 兴趣 / 技术栈 / 习惯 …）"
                rows={3}
              />
            </div>
            <div className="row">
              <label>桌宠对话风格</label>
              <select
                className="profile-input"
                value={profile.personaPreset}
                onChange={(e) =>
                  updateProfileField('personaPreset', e.target.value as PersonaPreset)
                }
              >
                {(Object.keys(PERSONA_PRESET_LABELS) as PersonaPreset[]).map((k) => (
                  <option key={k} value={k}>
                    {PERSONA_PRESET_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>自定义风格补充</label>
              <textarea
                className="profile-textarea"
                value={profile.personaCustom}
                onChange={(e) => updateProfileField('personaCustom', e.target.value)}
                placeholder="（如：喜欢中英混用术语、回答尽量短、不要 emoji…）"
                rows={2}
              />
            </div>
            <div className="row">
              <button
                onClick={handleSaveProfile}
                disabled={!profileDirty}
                className="primary"
              >
                保存档案
              </button>
              <button onClick={handleResetWizard} className="danger">
                重置 wizard（让 AI 重问一遍）
              </button>
            </div>
          </>
        ) : (
          <p className="hint">加载中...</p>
        )}
      </section>

      {/* —— 6. 记忆（M5-2） —— */}
      <section>
        <h2>跨会话记忆</h2>
        <div className="row">
          <label>对话历史</label>
          <button onClick={handleClearChatHistory} className="danger">
            清空对话历史
          </button>
        </div>
        <p className="hint">
          保留最近 10 对话往复；桌宠重启后自动恢复让对话不丢上下文。点上面按钮
          会同步清空桌宠对话区 UI。
        </p>

        <div className="row" style={{ marginTop: 14 }}>
          <label>长期记忆（可直接编辑）</label>
          <button onClick={refreshMemory}>从盘上重读</button>
          <button onClick={handleClearMemory} className="danger">
            清空全部
          </button>
          <button
            onClick={handleSaveMemory}
            disabled={!memoryDirty}
            className="primary"
          >
            保存
          </button>
        </div>
        <p className="hint">
          AI 调 <code>remember</code> tool 时自动追加到这里。你也可以直接改 ——
          每行一条事实，AI 下次对话会看到。markdown 格式自由发挥。
        </p>
        {memoryLoaded && (
          <textarea
            className="memory-editor"
            value={memoryDraft}
            onChange={(e) => handleMemoryChange(e.target.value)}
            placeholder="（空 —— AI 还没记下任何东西；你也可以手动写。每行一条事实）"
            rows={10}
          />
        )}
      </section>

      {/* —— 7. About —— */}
      <section>
        <h2>关于</h2>
        <p>DeskPet 智能桌宠助手 · 透明置顶桌宠 + 多模态 AI（6 provider 多家选）</p>
        <p className="hint">
          快捷键：<code>⌘+,</code> 打开本面板 · <code>⌘+⇧+P</code> 显示/隐藏桌宠 · <code>⌘+Q</code> 退出
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default Settings
