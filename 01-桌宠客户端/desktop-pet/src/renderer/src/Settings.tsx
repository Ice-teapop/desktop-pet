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
import type { ProviderBalance } from '../../shared/provider-balance-types'
import { t } from '../../shared/i18n'
// v0.5.0: About 页头图改用 deskpet-furina idle (Furina 默认姿态)
import aboutHeroSvg from '@themes/deskpet-furina/svg/idle.svg'
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
  // 动态拉的 provider model 列表 (24h cache + 异步 refresh, 同 chat pill 数据源).
  // 修 PR-1: Settings dropdown 之前用静态 modelsForProvider() → 跟 pill 不一致 (pill 用动态).
  // 启动期 / API 不通时 dynamic 为空 → render 自动 fallback 到静态列表。
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  // 改动 5 [#5] provider 余额 — 用户点"查余额"按钮才 fetch (不主动拉所有)
  const [providerBalances, setProviderBalances] = useState<
    Partial<Record<Provider, ProviderBalance>>
  >({})
  const [balanceLoading, setBalanceLoading] = useState<Partial<Record<Provider, boolean>>>({})

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
    const offAvailableModels = window.api.onAvailableModels((m) => setModelsByProvider(m))
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
    window.api.requestAvailableModels()
    window.api.requestTavilyState()
    window.api.requestVisionState()
    window.api.requestPrefsState()
    window.api.requestTrustedDirsState()
    window.api.requestUserProfileState()
    return () => {
      offProviderKeyStates()
      offSelectedModel()
      offAvailableModels()
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
    showToast(t('settings.toast.key_saved', PROVIDERS[provider].label))
  }
  const handleProviderReset = (provider: Provider): void => {
    window.api.resetProviderKey(provider)
    setProviderKeyDrafts((prev) => ({ ...prev, [provider]: '' }))
    showToast(t('settings.toast.key_cleared', PROVIDERS[provider].label))
  }
  // 改动 5 [#5] 查余额 — 点击触发, 写 balanceLoading + 结果到 providerBalances.
  const handleFetchBalance = async (provider: Provider): Promise<void> => {
    setBalanceLoading((prev) => ({ ...prev, [provider]: true }))
    try {
      const result = (await window.api.fetchProviderBalance(provider)) as ProviderBalance
      setProviderBalances((prev) => ({ ...prev, [provider]: result }))
    } finally {
      setBalanceLoading((prev) => ({ ...prev, [provider]: false }))
    }
  }

  // —— Selected model actions ——
  const handleProviderChange = (newProvider: Provider): void => {
    if (!selectedModel || selectedModel.provider === newProvider) return
    const defaultSel = defaultModelForProvider(newProvider)
    window.api.setSelectedModel(defaultSel)
    showToast(t('settings.toast.switched_provider', PROVIDERS[newProvider].label))
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
    showToast(t('settings.toast.tavily_saved'))
  }
  const handleTavilyReset = (): void => {
    window.api.resetTavilyKey()
    setTavilyKeyDraft('')
    showToast(t('settings.toast.tavily_cleared'))
  }

  // —— Vision actions ——
  const handleRevokeVision = (): void => {
    window.api.revokeVisionConsent()
    showToast(t('settings.toast.vision_revoked'))
  }
  const handleToggleVision = (enable: boolean): void => {
    window.api.setVisionEnabled(enable)
  }

  // —— Audit log ——
  const handleRevealAudit = (): void => window.api.revealAuditLogInFinder()
  const handleClearAudit = async (): Promise<void> => {
    const r = await window.api.clearAuditLog()
    showToast(r.ok ? t('settings.toast.audit_cleared') : t('settings.toast.audit_clear_failed', r.error))
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
      showToast(t('settings.toast.memory_saved'))
    } else {
      showToast(t('settings.toast.memory_save_failed', r.error))
    }
  }
  const handleClearMemory = async (): Promise<void> => {
    const r = await window.api.clearMemory()
    if (r.ok) {
      setMemoryContent('')
      setMemoryDraft('')
      setMemoryDirty(false)
      showToast(t('settings.toast.memory_cleared'))
    } else {
      showToast(t('settings.toast.memory_clear_failed', r.error))
    }
  }
  const handleClearChatHistory = async (): Promise<void> => {
    const r = await window.api.clearChatHistory()
    showToast(r.ok ? t('settings.toast.chat_history_cleared') : t('settings.toast.chat_history_clear_failed', r.error))
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
      showToast(t('settings.toast.profile_saved'))
    } else {
      showToast(t('settings.toast.profile_save_failed', r.error))
    }
  }
  const handleResetWizard = async (): Promise<void> => {
    const r = await window.api.resetUserProfileSetup()
    if (r.ok) {
      setProfileDirty(false)
      showToast(t('settings.toast.wizard_reset'))
    } else {
      showToast(t('settings.toast.wizard_reset_failed', r.error))
    }
  }

  // —— Trusted dirs ——
  const handleRevokePersistent = async (dir: string): Promise<void> => {
    const r = await window.api.revokeTrustedDirPersistent(dir)
    showToast(r.ok ? t('settings.toast.persistent_revoked', dir) : t('settings.toast.persistent_revoke_failed', r.error))
  }
  const handleRevokeAllSession = (): void => {
    window.api.revokeAllSessionTrustedDirs()
    showToast(t('settings.toast.session_dirs_cleared'))
  }

  // —— Prefs setters（非 model 类，model 走 setSelectedModel） ——
  const handleSetFollow = (v: boolean): void => window.api.setFollowFrontApp(v)
  const handleSetFastPath = (v: boolean): void => window.api.setUseFastPath(v)

  // —— Render ——
  return (
    <div className="settings-app">
      <h1>{t('settings.h1')}</h1>

      {/* —— 1. API Keys (M7-5 multi-provider) —— */}
      <section>
        <h2>{t('settings.section.ai_engine')}</h2>
        <p className="hint">{t('settings.ai_engine_hint')}</p>

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
                  {isActive && <span className="chip-current">{t('settings.chip_current')}</span>}
                  {info.label}
                </label>
                {configured && !isActive && (
                  <button
                    className="btn-switch-provider"
                    onClick={() => handleProviderChange(providerId)}
                  >
                    {t('settings.switch_to')}
                  </button>
                )}
                {!configured && (
                  <span className="badge badge-muted">{t('settings.unconfigured')}</span>
                )}
              </div>
              <p className="hint">{info.description}</p>

              {/* Model dropdown — 仅 active 时展开 (避免 6 个卡都展开噪音).
                 PR-1: 数据源跟 chat pill (App.tsx:1106) 对齐 — dynamic listModels
                 primary, 静态 modelsForProvider 作 fallback (启动期 / API 不通 / 新
                 装且未连过任何 provider 时). metadata (label / 推理 / tool / vision
                 tag) 仍走静态查询, 动态 list 里的新 modelId 没 metadata 时直接显
                 raw id 不带 tag. */}
              {isActive && selectedModel && (() => {
                const staticEntries = modelsForProvider(providerId)
                const dynamicIds = modelsByProvider[providerId] ?? []
                const modelIds =
                  dynamicIds.length > 0 ? dynamicIds : staticEntries.map((e) => e.id)
                const metaById = new Map(staticEntries.map((e) => [e.id, e]))
                // 当前 selectedModel.modelId 不在列表里时显示一条占位避免 select 空 value
                const idsWithCurrent = modelIds.includes(selectedModel.modelId)
                  ? modelIds
                  : [selectedModel.modelId, ...modelIds]
                return (
                  <div className="row">
                    <label>{t('settings.current_model')}</label>
                    <select
                      value={selectedModel.modelId}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="profile-input"
                    >
                      {idsWithCurrent.map((id) => {
                        const meta = metaById.get(id)
                        const tags: string[] = []
                        if (meta?.isReasoning) tags.push(t('settings.tag_reasoning'))
                        if (meta && !meta.supportsTools) tags.push(t('settings.tag_no_tool'))
                        if (meta && !meta.supportsVision) tags.push(t('settings.tag_no_vision'))
                        const label = meta?.label ?? id
                        return (
                          <option key={id} value={id}>
                            {label}
                            {tags.length > 0 ? ` (${tags.join(' / ')})` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                )
              })()}

              <div className="row">
                <input
                  type="password"
                  className="profile-input"
                  placeholder={
                    configured
                      ? t('settings.placeholder_overwrite')
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
                  {t('settings.save')}
                </button>
                <button
                  onClick={() => handleProviderReset(providerId)}
                  disabled={!configured}
                  className="danger"
                >
                  {t('settings.clear')}
                </button>
              </div>
              <p className="hint">
                {t('settings.registration')}<code>{info.registrationUrl}</code>
              </p>
              {/* 改动 5 [#5] 余额 / 用量行 — 只 configured 才显示 */}
              {configured && (
                <div className="row provider-balance-row">
                  <label>{t('settings.balance_label')}</label>
                  {(() => {
                    const b = providerBalances[providerId]
                    const loading = balanceLoading[providerId]
                    if (loading) return <span className="hint">{t('settings.balance_loading')}</span>
                    if (b?.kind === 'ok') {
                      return (
                        <>
                          <span className="badge badge-ok">{b.label}</span>
                          <button
                            className="btn-link"
                            onClick={() => handleFetchBalance(providerId)}
                          >
                            {t('settings.balance_refresh')}
                          </button>
                        </>
                      )
                    }
                    if (b?.kind === 'unsupported') {
                      return (
                        <span className="hint">
                          {b.reason} →{' '}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(info.usageDashboardUrl, '_blank')
                            }}
                          >
                            {t('settings.balance_dashboard_link')}
                          </a>
                        </span>
                      )
                    }
                    if (b?.kind === 'error') {
                      return (
                        <>
                          <span className="hint" style={{ color: 'var(--warn)' }}>
                            ⚠ {b.message}
                          </span>
                          <button
                            className="btn-link"
                            onClick={() => handleFetchBalance(providerId)}
                          >
                            {t('settings.balance_retry')}
                          </button>
                        </>
                      )
                    }
                    // 首次, 还没拉
                    return info.hasPublicBalanceApi ? (
                      <button
                        className="btn-link"
                        onClick={() => handleFetchBalance(providerId)}
                      >
                        {t('settings.balance_check')}
                      </button>
                    ) : (
                      <span className="hint">
                        {t('settings.balance_no_api')}{' '}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            window.open(info.usageDashboardUrl, '_blank')
                          }}
                        >
                          {t('settings.balance_dashboard')}
                        </a>
                      </span>
                    )
                  })()}
                </div>
              )}
              {isActive && (
                <p className="hint provider-fallback-hint">
                  {t('settings.fallback_hint')}
                </p>
              )}
            </div>
          )
        })}
        {!selectedModel && (
          <p className="hint" style={{ marginTop: 12 }}>
            {t('settings.loading_state')}
          </p>
        )}

        {/* —— Tavily 联网搜索（不是 LLM provider，单独 card） —— */}
        <div className="provider-card" style={{ marginTop: 16 }}>
          <div className="row">
            <label>{t('settings.tavily.label')}</label>
            <span
              className={`badge ${tavilyState?.kind === 'configured' ? 'badge-ok' : 'badge-muted'}`}
            >
              {tavilyState?.kind === 'configured' ? t('settings.tavily.configured') : t('settings.tavily.unconfigured')}
            </span>
          </div>
          <p className="hint">{t('settings.tavily.hint')}</p>
          <div className="row">
            <input
              type="password"
              className="profile-input"
              placeholder={
                tavilyState?.kind === 'configured'
                  ? t('settings.placeholder_overwrite')
                  : t('settings.tavily.placeholder')
              }
              value={tavilyKeyDraft}
              onChange={(e) => setTavilyKeyDraft(e.target.value)}
            />
            <button
              onClick={handleTavilySubmit}
              disabled={!tavilyKeyDraft.trim()}
              className="primary"
            >
              {t('settings.save')}
            </button>
            <button
              onClick={handleTavilyReset}
              disabled={tavilyState?.kind !== 'configured'}
              className="danger"
            >
              {t('settings.clear')}
            </button>
          </div>
          <p className="hint">
            {t('settings.tavily.registration')}<code>tavily.com</code>
          </p>
        </div>
      </section>

      {/* —— 2. 识别 / 自动化 (provider + model cascade 已搬到 section 1 卡片) —— */}
      <section>
        <h2>{t('settings.section.recognition')}</h2>
        <p className="hint">{t('settings.recognition.hint')}</p>

        <div className="row" style={{ marginTop: 14 }}>
          <label>
            <input
              type="checkbox"
              checked={prefs?.followFrontApp ?? false}
              onChange={(e) => handleSetFollow(e.target.checked)}
              disabled={!prefs}
            />
            <span>{t('settings.recognition.follow_front')}</span>
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
            <span>{t('settings.recognition.strict_llm')}</span>
          </label>
        </div>
      </section>

      {/* —— 3. Agentic Tools —— */}
      <section>
        <h2>{t('settings.section.agentic')}</h2>
        <div className="row">
          <label>{t('settings.agentic.label')}</label>
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
              ? t('settings.agentic.status_enabled')
              : visionState?.kind === 'disabled'
                ? t('settings.agentic.status_disabled')
                : t('settings.agentic.status_no_consent')}
          </span>
        </div>
        {visionState?.kind === 'disabled-no-consent' && (
          <div className="row" style={{ flexDirection: 'column', gap: 6 }}>
            <p className="hint" style={{ margin: 0 }}>
              {t('settings.agentic.consent_hint')}
            </p>
            <div className="row" style={{ marginTop: 4 }}>
              <button
                onClick={() => {
                  window.api.acceptVisionConsentAndEnable()
                  showToast(t('settings.toast.vision_consent_enabled'))
                }}
              >
                {t('settings.agentic.consent_accept')}
              </button>
            </div>
          </div>
        )}
        {visionState?.kind === 'disabled' && (
          <div className="row">
            <button onClick={() => handleToggleVision(true)}>{t('settings.agentic.enable')}</button>
            <button onClick={handleRevokeVision} className="danger">
              {t('settings.agentic.revoke')}
            </button>
          </div>
        )}
        {visionState?.kind === 'enabled' && (
          <div className="row">
            <button onClick={() => handleToggleVision(false)}>{t('settings.agentic.disable')}</button>
            <button onClick={handleRevokeVision} className="danger">
              {t('settings.agentic.revoke')}
            </button>
          </div>
        )}
        <details className="tool-list-details">
          <summary>{t('settings.agentic.tools_summary')}</summary>
          <ul className="tool-list">
            <li>
              <b>view_screen</b> / read_clipboard / current_app_info {t('settings.agentic.tools_li_1')}
            </li>
            <li>
              <b>open_url</b> / copy_to_clipboard {t('settings.agentic.tools_li_2')}
            </li>
            <li>
              <b>read_file</b> / list_directory / find_files {t('settings.agentic.tools_li_3')}
            </li>
            <li>
              <b>write_file</b> / create_directory / delete_file {t('settings.agentic.tools_li_4')}
            </li>
            <li>
              <b>run_command</b> {t('settings.agentic.tools_li_5')}
            </li>
            <li>
              <b>open_system_settings</b> / read_system_preference {t('settings.agentic.tools_li_6')}
            </li>
            <li>
              <b>fetch_url</b> / web_search {t('settings.agentic.tools_li_7')}
            </li>
          </ul>
        </details>
      </section>

      {/* —— 4. Trust & Audit —— */}
      <section>
        <h2>{t('settings.section.trust_dirs')}</h2>
        <div className="row">
          <label>{t('settings.trust.persistent_label')}</label>
        </div>
        {trustedDirs && trustedDirs.persistent.length > 0 ? (
          <ul className="dir-list">
            {trustedDirs.persistent.map((d) => (
              <li key={d}>
                <code>{d}</code>
                <button className="small danger" onClick={() => handleRevokePersistent(d)}>
                  {t('settings.trust.persistent_revoke')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">{t('settings.trust.persistent_empty')}</p>
        )}
        <div className="row">
          <label>{t('settings.trust.session_label')}</label>
          <span className="badge badge-muted">
            {trustedDirs ? t('settings.trust.session_count', String(trustedDirs.session.length)) : '...'}
          </span>
          <button
            onClick={handleRevokeAllSession}
            disabled={!trustedDirs || trustedDirs.session.length === 0}
          >
            {t('settings.trust.session_clear')}
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
        <p className="hint">{t('settings.trust.note')}</p>
        <div className="row">
          <label>{t('settings.audit.label')}</label>
          <button onClick={handleRevealAudit}>{t('settings.audit.reveal')}</button>
          <button onClick={handleClearAudit} className="danger">
            {t('settings.audit.clear')}
          </button>
        </div>
        <p className="hint">{t('settings.audit.hint')}</p>
      </section>

      {/* —— 5. 用户档案（M5-3） —— */}
      <section>
        <h2>{t('settings.section.user_profile')}</h2>
        {profile ? (
          <>
            <div className="row">
              <label>{t('settings.profile.status_label')}</label>
              <span
                className={`badge ${profile.setupCompleted ? 'badge-ok' : 'badge-warn'}`}
              >
                {profile.setupCompleted ? t('settings.profile.status_set') : t('settings.profile.status_unset')}
              </span>
            </div>
            <div className="row">
              <label>{t('settings.profile.name_label')}</label>
              <input
                type="text"
                className="profile-input"
                value={profile.name}
                onChange={(e) => updateProfileField('name', e.target.value)}
                placeholder={t('settings.profile.name_placeholder')}
              />
            </div>
            <div className="row">
              <label>{t('settings.profile.about_label')}</label>
              <textarea
                className="profile-textarea"
                value={profile.about}
                onChange={(e) => updateProfileField('about', e.target.value)}
                placeholder={t('settings.profile.about_placeholder')}
                rows={3}
              />
            </div>
            <div className="row">
              <label>{t('settings.profile.persona_label')}</label>
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
              <label>{t('settings.profile.persona_custom_label')}</label>
              <textarea
                className="profile-textarea"
                value={profile.personaCustom}
                onChange={(e) => updateProfileField('personaCustom', e.target.value)}
                placeholder={t('settings.profile.persona_custom_placeholder')}
                rows={2}
              />
            </div>
            <div className="row">
              <button
                onClick={handleSaveProfile}
                disabled={!profileDirty}
                className="primary"
              >
                {t('settings.profile.save')}
              </button>
              <button onClick={handleResetWizard} className="danger">
                {t('settings.profile.reset_wizard')}
              </button>
            </div>
          </>
        ) : (
          <p className="hint">{t('settings.profile.loading')}</p>
        )}
      </section>

      {/* —— 6. 记忆（M5-2） —— */}
      <section>
        <h2>{t('settings.section.memory')}</h2>
        <div className="row">
          <label>{t('settings.memory.history_label')}</label>
          <button onClick={handleClearChatHistory} className="danger">
            {t('settings.memory.history_clear')}
          </button>
        </div>
        <p className="hint">{t('settings.memory.history_hint')}</p>

        <div className="row" style={{ marginTop: 14 }}>
          <label>{t('settings.memory.long_label')}</label>
          <button onClick={refreshMemory}>{t('settings.memory.reread')}</button>
          <button onClick={handleClearMemory} className="danger">
            {t('settings.memory.clear_all')}
          </button>
          <button
            onClick={handleSaveMemory}
            disabled={!memoryDirty}
            className="primary"
          >
            {t('settings.memory.save')}
          </button>
        </div>
        <p className="hint">{t('settings.memory.hint')}</p>
        {memoryLoaded && (
          <textarea
            className="memory-editor"
            value={memoryDraft}
            onChange={(e) => handleMemoryChange(e.target.value)}
            placeholder={t('settings.memory.placeholder')}
            rows={10}
          />
        )}
      </section>

      {/* —— 7. About —— */}
      <section>
        <h2>{t('settings.section.about')}</h2>
        <div className="about-hero">
          <img src={aboutHeroSvg} alt="DeskPet hero" />
        </div>
        <p>{t('settings.about.body')}</p>
        <p className="hint">
          {t('settings.about.shortcuts', '⌘+,', '⌘+⇧+P', '⌘+Q')}
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default Settings
