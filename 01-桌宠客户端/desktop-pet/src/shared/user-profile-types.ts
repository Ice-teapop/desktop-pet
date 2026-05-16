/**
 * 用户档案类型（M5-3）—— shared between main / preload / renderer / tools。
 *
 * 通过 wizard 对话或设置面板手动编辑收集；注入 system prompt 让 AI 一直
 * 记得用户的称呼 / 背景 / 偏好的对话风格。
 */

export type PersonaPreset =
  | 'warm-friend' // 温暖朋友（默认）
  | 'professional' // 简洁专业
  | 'witty-cold' // 冷淡毒舌
  | 'playful' // 玩伴谐星
  | 'custom' // 不用预设，全自定义

export interface UserProfile {
  /** 用户希望被怎么称呼 */
  name: string
  /** 关于用户的开放描述（背景/兴趣/项目/技术栈） */
  about: string
  /** 桌宠对话风格的预设 */
  personaPreset: PersonaPreset
  /** 在预设基础上的自定义补充（追加，不替换预设） */
  personaCustom: string
  /** wizard 是否完成 —— false 时 system prompt 走 setup mode */
  setupCompleted: boolean
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  about: '',
  personaPreset: 'warm-friend',
  personaCustom: '',
  setupCompleted: false
}

/** 预设人设的中文描述 —— UI 显示 + system prompt 注入两边复用 */
export const PERSONA_PRESET_LABELS: Record<PersonaPreset, string> = {
  'warm-friend': '温暖朋友（默认）',
  professional: '简洁专业',
  'witty-cold': '冷淡毒舌',
  playful: '玩伴谐星',
  custom: '完全自定义'
}

/** 预设转 system prompt 用的风格描述（详细版，给 AI 看） */
export const PERSONA_PRESET_PROMPTS: Record<PersonaPreset, string> = {
  'warm-friend':
    '温暖、像老朋友一样轻松聊。中文为主、简短回应、偶尔关心一下对方状态；不卖弄不啰嗦。',
  professional:
    '简洁专业。直接给答案，少寒暄、少 emoji；技术问题精确、不展开无关 context；行家对话感。',
  'witty-cold':
    '冷淡毒舌但不失善意。直球、偶尔吐槽用户的笨问题或拖延行为，但答案还是有用的；像个高冷但靠谱的工程师朋友。',
  playful:
    '俏皮玩伴。轻松吐槽、爱用谐音梗或冷笑话；像个 always online 的同事，话密但有趣；技术内容不掺水。',
  custom: '（无预设 —— 完全按用户自定义补充描述执行）'
}
