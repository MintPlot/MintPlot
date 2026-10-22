/**
 * 叙事风格配置器（M4-nstyle）— 类型、参数元数据、默认值与内置预设。
 *
 * 设计对齐项目纪律：
 *  - 配置为纯数据（可 JSON 持久化、可校验、可导入导出），提示词转换在
 *    prompt.ts、存储在 nstyle-store.ts、UI 在 sections/NstylePanel.vue。
 *  - 全部数值参数统一 0–100；低值不等于禁止、高值不等于机械堆叠——
 *    语义由 prompt.ts 的分档措辞承担。
 *  - 预设是「参数组合」而不是空名字：八套预设的数值与叙述方式各不相同。
 */

/** 12 个核心叙事参数的键。 */
export type NstyleParamKey =
  | 'dialogue'
  | 'psychology'
  | 'environment'
  | 'action'
  | 'emotion'
  | 'pacing'
  | 'interaction'
  | 'narration'
  | 'sensory'
  | 'detail'
  | 'complexity'
  | 'subtext'

/** 八个叙述方式选项键。 */
export type NstyleViewpoint = 'first' | 'third' | 'thirdLimited' | 'omniscient' | 'auto'
export type NstyleTense = 'past' | 'present' | 'auto'
export type NstyleMonologue = 'off' | 'some' | 'rich'
export type NstyleMode = 'dialogueLed' | 'balanced' | 'narrationLed' | 'auto'
export type NstyleLength = 'concise' | 'standard' | 'detailed' | 'adaptive'
export type NstylePortrayal = 'behavior' | 'dialogue' | 'inner' | 'mixed'
export type NstyleTransition = 'cut' | 'smooth' | 'lingering'
export type NstyleLanguage = 'plain' | 'natural' | 'rich' | 'literary'

export interface NstyleNarration {
  viewpoint: NstyleViewpoint
  tense: NstyleTense
  monologue: NstyleMonologue
  mode: NstyleMode
  length: NstyleLength
  portrayal: NstylePortrayal
  transition: NstyleTransition
  language: NstyleLanguage
}

export interface NstyleConfig {
  params: Record<NstyleParamKey, number>
  narration: NstyleNarration
  /** 风格标签（内置多选 + 用户自定义，合并存放）。 */
  tags: string[]
}

/** 一份可持久化的风格档案（内置预设与用户自定义共用形状）。 */
export interface NstyleProfile {
  readonly id: string
  name: string
  description: string
  config: NstyleConfig
  readonly builtin: boolean
  /** 配置结构版本（导入导出与兼容处理用）。 */
  version: number
  createdAt: number
  updatedAt: number
}

/** 参数展示名（面板滑块标签）。 */
export const NSTYLE_PARAM_META: Readonly<Record<NstyleParamKey, string>> = {
  dialogue: '对话密度',
  psychology: '心理描写',
  environment: '环境描写',
  action: '动作细节',
  emotion: '情绪表达',
  pacing: '剧情推进速度',
  interaction: '角色互动',
  narration: '旁白比重',
  sensory: '感官描写',
  detail: '细节丰富度',
  complexity: '情节复杂度',
  subtext: '留白程度',
}

export const NSTYLE_PARAM_KEYS = Object.keys(NSTYLE_PARAM_META) as NstyleParamKey[]

/** 叙述方式选项（键 → 展示名）。 */
export const NSTYLE_VIEWPOINTS: Readonly<Record<NstyleViewpoint, string>> = {
  first: '第一人称',
  third: '第三人称',
  thirdLimited: '第三人称有限视角',
  omniscient: '全知视角',
  auto: '自动适配',
}
export const NSTYLE_TENSES: Readonly<Record<NstyleTense, string>> = {
  past: '过去时',
  present: '现在时',
  auto: '自动适配',
}
export const NSTYLE_MONOLOGUES: Readonly<Record<NstyleMonologue, string>> = {
  off: '关闭',
  some: '适量',
  rich: '丰富',
}
export const NSTYLE_MODES: Readonly<Record<NstyleMode, string>> = {
  dialogueLed: '以对话为主',
  balanced: '对话与叙述平衡',
  narrationLed: '以叙述为主',
  auto: '自动适配',
}
export const NSTYLE_LENGTHS: Readonly<Record<NstyleLength, string>> = {
  concise: '简洁',
  standard: '标准',
  detailed: '细腻',
  adaptive: '自适应',
}
export const NSTYLE_PORTRAYALS: Readonly<Record<NstylePortrayal, string>> = {
  behavior: '以行为表现为主',
  dialogue: '以语言与对话表现为主',
  inner: '以内心活动表现为主',
  mixed: '多种方式平衡',
}
export const NSTYLE_TRANSITIONS: Readonly<Record<NstyleTransition, string>> = {
  cut: '快速切换',
  smooth: '自然过渡',
  lingering: '细腻过渡',
}
export const NSTYLE_LANGUAGES: Readonly<Record<NstyleLanguage, string>> = {
  plain: '简洁直白',
  natural: '自然流畅',
  rich: '丰富细腻',
  literary: '文学化',
}

/** 内置风格标签（可多选；自定义标签与此并列）。 */
export const NSTYLE_BUILTIN_TAGS: readonly string[] = [
  '温柔', '轻松', '幽默', '浪漫', '细腻', '压抑', '紧张', '黑暗',
  '神秘', '史诗感', '写实', '戏剧化', '治愈', '荒诞', '冷峻', '热血',
  '日常感', '沉浸感',
]

export const NSTYLE_VERSION = 1

/** 默认参数（规范表）。 */
export const DEFAULT_STORY_PARAMS: Readonly<Record<NstyleParamKey, number>> = {
  dialogue: 75,
  psychology: 60,
  environment: 45,
  action: 55,
  emotion: 70,
  pacing: 55,
  interaction: 80,
  narration: 40,
  sensory: 45,
  detail: 60,
  complexity: 55,
  subtext: 40,
}

export const DEFAULT_STORY_NARRATION: Readonly<NstyleNarration> = {
  viewpoint: 'auto',
  tense: 'auto',
  monologue: 'some',
  mode: 'balanced',
  length: 'standard',
  portrayal: 'mixed',
  transition: 'smooth',
  language: 'natural',
}

export const DEFAULT_STORY_CONFIG: Readonly<NstyleConfig> = {
  params: { ...DEFAULT_STORY_PARAMS },
  narration: { ...DEFAULT_STORY_NARRATION },
  tags: [],
}

const paramsOf = (overrides: Partial<Record<NstyleParamKey, number>>): Record<NstyleParamKey, number> => ({
  ...DEFAULT_STORY_PARAMS,
  ...overrides,
})

const narrationOf = (overrides: Partial<NstyleNarration>): NstyleNarration => ({
  ...DEFAULT_STORY_NARRATION,
  ...overrides,
})

/**
 * 八个内置预设 —— 每一套都是真实不同的参数组合（规范 3.1：
 * 「不同预设必须对应实际不同的参数组合，不能只改变名称」）。
 */
export const NSTYLE_PRESETS: readonly NstyleProfile[] = [
  {
    id: 'preset-balanced',
    name: '均衡叙事',
    description: '对话、描写和剧情推进保持平衡。',
    config: { params: paramsOf({}), narration: narrationOf({}), tags: [] },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-lightnovel',
    name: '轻小说风格',
    description: '对话自然，角色个性鲜明，情绪表达直接。',
    config: {
      params: paramsOf({ dialogue: 90, psychology: 70, emotion: 85, interaction: 90, narration: 25, environment: 30, sensory: 40, complexity: 45, subtext: 30 }),
      narration: narrationOf({ mode: 'dialogueLed', portrayal: 'dialogue', language: 'natural', length: 'standard', monologue: 'some', transition: 'cut' }),
      tags: ['轻松', '日常感'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-cinematic',
    name: '电影感叙事',
    description: '注重镜头感、动作、环境和场景转换。',
    config: {
      params: paramsOf({ dialogue: 55, environment: 80, action: 85, pacing: 75, sensory: 75, narration: 55, psychology: 40, subtext: 55 }),
      narration: narrationOf({ mode: 'narrationLed', portrayal: 'behavior', transition: 'cut', language: 'rich', length: 'detailed' }),
      tags: ['史诗感', '写实'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-immersive',
    name: '沉浸式角色扮演',
    description: '注重角色反应、互动、临场感和连续性。',
    config: {
      params: paramsOf({ dialogue: 85, psychology: 75, emotion: 80, interaction: 95, pacing: 45, environment: 50, sensory: 60, detail: 70, subtext: 50 }),
      narration: narrationOf({ mode: 'dialogueLed', portrayal: 'mixed', monologue: 'some', transition: 'smooth', length: 'adaptive' }),
      tags: ['沉浸感', '日常感'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-literary',
    name: '文学描写',
    description: '注重语言质感、意象、氛围与内心活动。',
    config: {
      params: paramsOf({ dialogue: 40, psychology: 90, environment: 85, sensory: 85, narration: 70, detail: 90, pacing: 30, emotion: 75, subtext: 70, complexity: 60 }),
      narration: narrationOf({ mode: 'narrationLed', portrayal: 'inner', monologue: 'rich', language: 'literary', length: 'detailed', transition: 'lingering' }),
      tags: ['细腻', '治愈'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-suspense',
    name: '悬疑紧张',
    description: '注重线索、信息差、节奏控制和悬念。',
    config: {
      params: paramsOf({ dialogue: 65, psychology: 70, environment: 70, pacing: 65, interaction: 70, subtext: 85, complexity: 85, emotion: 55, sensory: 55, detail: 65 }),
      narration: narrationOf({ mode: 'balanced', portrayal: 'behavior', monologue: 'some', language: 'natural', length: 'standard', transition: 'smooth' }),
      tags: ['紧张', '神秘'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-fastpaced',
    name: '快节奏剧情',
    description: '减少冗长描写，突出事件、冲突和行动。',
    config: {
      params: paramsOf({ dialogue: 70, environment: 20, action: 90, pacing: 95, psychology: 35, sensory: 25, narration: 30, detail: 30, complexity: 65, subtext: 25 }),
      narration: narrationOf({ mode: 'balanced', portrayal: 'behavior', length: 'concise', language: 'plain', transition: 'cut', monologue: 'off' }),
      tags: ['热血', '戏剧化'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-slowdaily',
    name: '慢热日常',
    description: '注重生活细节、人物关系和自然互动。',
    config: {
      params: paramsOf({ dialogue: 75, psychology: 65, environment: 60, sensory: 65, emotion: 70, interaction: 85, pacing: 25, action: 40, complexity: 35, subtext: 55, detail: 70 }),
      narration: narrationOf({ mode: 'balanced', portrayal: 'mixed', monologue: 'some', language: 'natural', length: 'adaptive', transition: 'lingering' }),
      tags: ['温柔', '日常感', '治愈'],
    },
    builtin: true,
    version: NSTYLE_VERSION,
    createdAt: 0,
    updatedAt: 0,
  },
]
