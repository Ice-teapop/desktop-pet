/**
 * 多 provider LLM 类型定义（M7-1）—— main / preload / renderer 共用单一源。
 *
 * 设计：
 *  - Provider = 一个 LLM 厂商（'anthropic' / 'openai' / 'google' / ...）
 *  - ModelEntry = 某 provider 暴露的具体 model + 能力 flag（vision/tools/reasoning）
 *  - SelectedModel = 当前激活的 { provider, modelId } —— 持久化在 preferences
 *
 * 加新 provider：在 PROVIDERS 加一行 + AVAILABLE_MODELS 加该 provider 的 model
 * 条目；providers.ts registry 加 createXxx 分支即可。
 */

export type Provider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'bytedance'

export interface ProviderInfo {
  id: Provider
  label: string
  /** Key 前缀正则（renderer 提示 + main 兜底校验）。undefined = 不强制前缀 */
  keyPattern?: RegExp
  /** 注册 API key 的 URL —— Settings UI 显示给用户 */
  registrationUrl: string
  /** 该 provider 的默认 model —— user 第一次切到该 provider 用这个 */
  defaultModel: string
  /** ENV var 名（dev 后门，优先于落盘 key） */
  envVar: string
  /** 一句话描述（Settings UI 显示） */
  description: string
}

export const PROVIDERS: Readonly<Record<Provider, ProviderInfo>> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    keyPattern: /^sk-ant-[\w-]{20,200}$/,
    registrationUrl: 'https://console.anthropic.com',
    defaultModel: 'claude-haiku-4-5',
    envVar: 'ANTHROPIC_API_KEY',
    description: '稳健 / vision + tools 一流 / Haiku 速度+成本最佳'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyPattern: /^sk-[\w-]{20,200}$/,
    registrationUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    envVar: 'OPENAI_API_KEY',
    description: 'GPT-4o + 推理 model (o1 / o3)'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    registrationUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    description: 'Gemini 2.5 / 免费 tier 1500 次/天 / 原生 Search grounding'
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    keyPattern: /^xai-[\w-]{20,200}$/,
    registrationUrl: 'https://console.x.ai',
    defaultModel: 'grok-2-1212',
    envVar: 'XAI_API_KEY',
    description: 'Grok / 实时 X feed search 独家 / 多个内置 tool'
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    keyPattern: /^sk-[\w-]{20,200}$/,
    registrationUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek V3 + R1 推理 / 性价比极高'
  },
  bytedance: {
    id: 'bytedance',
    label: '字节豆包',
    registrationUrl: 'https://console.volcengine.com/ark',
    defaultModel: 'doubao-pro-32k',
    envVar: 'ARK_API_KEY',
    description: '字节火山引擎 / 豆包系列 / 国内访问稳定'
  }
}

/** Provider 在 UI 里的展示顺序（Anthropic 第一是历史默认） */
export const PROVIDER_ORDER: readonly Provider[] = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'bytedance'
]

export interface ModelEntry {
  provider: Provider
  /** SDK 里用的 model ID 字符串 */
  id: string
  /** UI 显示标签 */
  label: string
  /** 是否支持 image input（决定 view_screen tool 暴露与否） */
  supportsVision: boolean
  /** 是否支持 tool calling（决定 agentic tools 暴露与否） */
  supportsTools: boolean
  /** 是否是推理 model（o1 / R1 / 等 —— UI 提示用户响应可能慢） */
  isReasoning?: boolean
}

export const AVAILABLE_MODELS: ReadonlyArray<ModelEntry> = [
  // —— Anthropic ——
  {
    provider: 'anthropic',
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5（快/便宜）',
    supportsVision: true,
    supportsTools: true
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6（平衡）',
    supportsVision: true,
    supportsTools: true
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7（强/贵）',
    supportsVision: true,
    supportsTools: true
  },
  // —— OpenAI ——
  {
    provider: 'openai',
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini（快/便宜）',
    supportsVision: true,
    supportsTools: true
  },
  {
    provider: 'openai',
    id: 'gpt-4o',
    label: 'GPT-4o（强/平衡）',
    supportsVision: true,
    supportsTools: true
  },
  {
    provider: 'openai',
    id: 'o3-mini',
    label: 'o3-mini（推理 / 较快）',
    supportsVision: false,
    supportsTools: true,
    isReasoning: true
  },
  {
    provider: 'openai',
    id: 'o1',
    label: 'o1（深度推理 / 慢）',
    supportsVision: true,
    supportsTools: false,
    isReasoning: true
  },
  // —— Google Gemini ——
  {
    provider: 'google',
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash（免费/快）',
    supportsVision: true,
    supportsTools: true
  },
  {
    provider: 'google',
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro（强）',
    supportsVision: true,
    supportsTools: true
  },
  // —— xAI Grok ——
  {
    provider: 'xai',
    id: 'grok-2-1212',
    label: 'Grok 2（文本）',
    supportsVision: false,
    supportsTools: true
  },
  {
    provider: 'xai',
    id: 'grok-2-vision-1212',
    label: 'Grok 2 Vision',
    supportsVision: true,
    supportsTools: true
  },
  // —— DeepSeek ——
  {
    provider: 'deepseek',
    id: 'deepseek-chat',
    label: 'DeepSeek V3（性价比）',
    supportsVision: false,
    supportsTools: true
  },
  {
    provider: 'deepseek',
    id: 'deepseek-reasoner',
    label: 'DeepSeek R1（推理 / 思考可见）',
    supportsVision: false,
    supportsTools: false,
    isReasoning: true
  },
  // —— ByteDance 豆包 ——
  {
    provider: 'bytedance',
    id: 'doubao-pro-32k',
    label: '豆包 Pro 32k',
    supportsVision: false,
    supportsTools: true
  },
  {
    provider: 'bytedance',
    id: 'doubao-vision-pro-32k',
    label: '豆包 Vision Pro 32k',
    supportsVision: true,
    supportsTools: true
  }
]

export interface SelectedModel {
  provider: Provider
  /** SDK model ID 字符串（如 'claude-haiku-4-5'） */
  modelId: string
}

/**
 * Provider → 是否配好 key 的 boolean map。Renderer 用来渲染 Settings UI（每张
 * provider 卡片 status 灯）。不暴露明文 key（key 永远不出 main 进程）。
 */
export type ProviderKeyStates = Record<Provider, boolean>

export const DEFAULT_SELECTED_MODEL: SelectedModel = {
  provider: 'anthropic',
  modelId: 'claude-haiku-4-5'
}

export function isValidProvider(value: unknown): value is Provider {
  return typeof value === 'string' && value in PROVIDERS
}

export function isValidSelectedModel(value: unknown): value is SelectedModel {
  if (typeof value !== 'object' || value === null) return false
  const o = value as { provider?: unknown; modelId?: unknown }
  if (!isValidProvider(o.provider)) return false
  if (typeof o.modelId !== 'string') return false
  return AVAILABLE_MODELS.some((m) => m.provider === o.provider && m.id === o.modelId)
}

export function modelsForProvider(provider: Provider): ModelEntry[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider)
}

export function findModel(sel: SelectedModel): ModelEntry | undefined {
  return AVAILABLE_MODELS.find((m) => m.provider === sel.provider && m.id === sel.modelId)
}

/** 该 provider 的默认 SelectedModel —— UI 上首次切 provider 时用 */
export function defaultModelForProvider(provider: Provider): SelectedModel {
  return { provider, modelId: PROVIDERS[provider].defaultModel }
}
