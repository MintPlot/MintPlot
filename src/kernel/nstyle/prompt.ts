/**
 * 叙事风格提示词构建器（M4-nstyle 核心）— 把结构化配置翻译成模型可执行的
 * 自然语言叙事指令。
 *
 * 规范 6.2/6.3：指令按参数分档动态生成（不是固定文本模板）；低值不等于禁止、
 * 高值不等于机械堆叠；参数冲突时输出协调措辞；结尾固定「风格不改写角色人格」
 * 的护栏。请求侧每轮只注入这一块的精简指令，不重复完整配置说明。
 */

import type { NstyleConfig, NstyleParamKey } from './types'
import { NSTYLE_PARAM_META } from './types'

type Band = 'veryLow' | 'low' | 'mid' | 'high' | 'veryHigh'

const bandOf = (value: number): Band => {
  if (value < 15) return 'veryLow'
  if (value < 40) return 'low'
  if (value < 65) return 'mid'
  if (value < 88) return 'high'
  return 'veryHigh'
}

/** 每个参数的推荐措辞（低 → 高五档；省略档位用「中」档兜底措辞）。 */
const PARAM_PHRASES: Readonly<Record<NstyleParamKey, Readonly<Record<Band, string>>>> = {
  dialogue: {
    veryLow: '尽量少用对话，仅在无法回避的关键时刻让人物开口',
    low: '对话从简，只在承载关键信息或转折时出现',
    mid: '对话与叙述并重，对话承担关键信息与情感交流',
    high: '优先以人物对话推进场景：允许自然打断、追问、回应与话题转移',
    veryHigh: '尽量让场景由连续的对话驱动，叙述退居连接与补位',
  },
  psychology: {
    veryLow: '几乎不直接写内心，只留可观察的行为痕迹',
    low: '内心活动点到即止，多以只言片语侧写',
    mid: '在关键节点适度呈现人物的内心活动',
    high: '深入呈现人物的想法、犹豫、矛盾与情绪变化',
    veryHigh: '大量深入内心：想法的流动、自我说服与自我怀疑都可以占据重要篇幅',
  },
  environment: {
    veryLow: '环境信息只保留理解剧情所必需的最低限度',
    low: '从简：一两笔交代必要的时间与地点即可',
    mid: '适度交代场景与氛围，服务剧情但不喧宾夺主',
    high: '充分描写场景、天气、光线与空间细节，让环境参与叙事',
    veryHigh: '环境是叙事主角之一：光线、声音、质感与空间层次都要细致铺开',
  },
  action: {
    veryLow: '动作只写结果，几乎省略过程',
    low: '动作描写简明扼要',
    mid: '动作描写适度，关键动作写清过程',
    high: '细致刻画人物动作、肢体语言与动作的节奏变化',
    veryHigh: '动作拆解到细节：姿态、力度、失衡与惯性都要可见',
  },
  emotion: {
    veryLow: '情绪几乎不直接呈现，靠读者推断',
    low: '情绪表达克制，点到为止',
    mid: '情绪变化清晰可读，但不过度渲染',
    high: '情绪的起伏、爆发与转折都要充分表达，让读者感同身受',
    veryHigh: '情绪是场景的核心：强度、层次与细微变化都要放大呈现',
  },
  pacing: {
    veryLow: '节奏放得很慢：允许场景长时间停留，充分展开互动与情感（但避免无意义的重复）',
    low: '节奏偏慢：给互动和情绪变化留足展开空间',
    mid: '节奏适中：互动与事件推进交替进行',
    high: '节奏偏快：每轮回复推进明确的事件或转折',
    veryHigh: '节奏极快：以事件和冲突密集推进，场景切换干脆利落',
  },
  interaction: {
    veryLow: '角色之间保持距离，互动降到最低',
    low: '角色互动有限，以必要交流为主',
    mid: '角色之间有来有回的正常互动',
    high: '强化角色之间的交流、反应与相互影响：接话、试探、配合与摩擦都要有',
    veryHigh: '多角色高频互动：彼此的反应、打断、站位与情绪感染构成场景主体',
  },
  narration: {
    veryLow: '压缩旁白，几乎完全贴近人物的所见所言',
    low: '旁白从简，仅作粘合与转场',
    mid: '旁白适度承担背景交代与视角引导',
    high: '叙述性旁白可以承担场景铺陈、背景交代与节奏收束',
    veryHigh: '旁白是重要叙事声部：评述、铺垫与时间过渡都由叙述承担',
  },
  sensory: {
    veryLow: '基本不写感官细节',
    low: '偶尔点到一两种感官印象',
    mid: '适度调用声音、气味、触感与温度',
    high: '充分调动五感：声音、气味、触感、温度与光线都要有着落',
    veryHigh: '感官是场景的底色：每个转场都伴随新的感官层次',
  },
  detail: {
    veryLow: '高度概括，只写骨架',
    low: '细节从简，以清晰为先',
    mid: '细节适中，重点处展开',
    high: '整体内容细致充分：表情、物件、动作与反应都有具体刻画',
    veryHigh: '细节极其丰富：微观表情与物件层次都纳入描写',
  },
  complexity: {
    veryLow: '只保留单一主线，保持清晰直白',
    low: '以主线为主，少量铺垫',
    mid: '主线清晰，辅以适度的铺垫与小转折',
    high: '可以铺设支线、伏笔与多层冲突，并让它们逐步交汇',
    veryHigh: '多线交织：伏笔、暗线与多方动机同时推进',
  },
  subtext: {
    veryLow: '把关键情绪与动机明确交代清楚，不留模糊空间',
    low: '偶尔留一点未说出口的余味',
    mid: '在关键节点保留适度的言外之意',
    high: '避免直接点破情绪与动机：用行为、语气、停顿与细节暗示',
    veryHigh: '大量留白：重要的话不说破，让沉默、错位与小动作承载含义',
  },
}

/** 叙述方式选项的措辞。 */
const VIEWPOINT_PHRASES: Readonly<Record<string, string>> = {
  first: '以第一人称「我」叙述',
  third: '以第三人称叙述，可按需进入人物内心',
  thirdLimited: '以第三人称有限视角叙述：只跟随视角人物的所知所感，不写他人内心',
  omniscient: '以全知视角叙述：可俯瞰多个人物与全局',
  auto: '视角跟随当前场景自然选择，不刻意限定',
}
const TENSE_PHRASES: Readonly<Record<string, string>> = {
  past: '以过去时态叙述',
  present: '以现在时态叙述',
  auto: '时态跟随上下文保持一致',
}
const MONOLOGUE_PHRASES: Readonly<Record<string, string>> = {
  off: '不要插入成段的内心独白',
  some: '在情绪转折处插入简短的内心独白',
  rich: '允许成段的内心独白直接呈现思绪',
}
const MODE_PHRASES: Readonly<Record<string, string>> = {
  dialogueLed: '整体以对话为主推进',
  balanced: '对话与叙述交替平衡推进',
  narrationLed: '整体以叙述为主推进',
  auto: '按场景需要自行选择对话或叙述的比重',
}
const LENGTH_PHRASES: Readonly<Record<string, string>> = {
  concise: '回复保持精炼，通常一到两段即可',
  standard: '回复长度适中，不刻意压缩也不注水',
  detailed: '回复可以更充分地展开，细节与层次更多',
  adaptive: '长度随场景需要伸缩：关键场景充分展开，过场从简——但绝不以注水拉长篇幅',
}
const PORTRAYAL_PHRASES: Readonly<Record<string, string>> = {
  behavior: '刻画人物以行为表现为主要手段',
  dialogue: '刻画人物以语言与对话为主要手段（用词、语气、口癖）',
  inner: '刻画人物以内心活动为主要手段',
  mixed: '刻画人物时行为、语言与内心并用',
}
const TRANSITION_PHRASES: Readonly<Record<string, string>> = {
  cut: '场景切换干脆利落，直接切到下一画面',
  smooth: '场景之间自然过渡',
  lingering: '场景转换处保留细节与呼吸感，慢慢收束再展开',
}
const LANGUAGE_PHRASES: Readonly<Record<string, string>> = {
  plain: '语言简洁直白，少用修饰',
  natural: '语言自然流畅，贴近日常表达',
  rich: '语言丰富细腻，允许较多的修饰与意象',
  literary: '语言文学化：讲求节奏、意象与措辞质感',
}

/** 参数冲突协调（规范 6.3）：返回需要追加的「协调」措辞列表。 */
export function harmonizeConflicts(config: NstyleConfig): string[] {
  const notes: string[] = []
  const p = config.params
  if (p.dialogue >= 70 && p.narration >= 70) {
    notes.push('对话与旁白都很高：让两者交替承担叙事——对话推现场，旁白负责收束与转场，避免大段堆叠。')
  }
  if (p.pacing <= 35 && p.interaction >= 70) {
    notes.push('节奏慢但互动强：以有内容的交流积累关系变化，避免寒暄式空转。')
  }
  if (config.narration.language === 'literary' && config.narration.length === 'concise') {
    notes.push('语言可以精炼而有质感：宁短勿赘，每一句都保留文学质感。')
  }
  if (p.emotion >= 70 && config.tags.includes('冷峻')) {
    notes.push('情绪表达克制而有力：以细节与留白传递强度，不直接宣泄。')
  }
  if (config.tags.includes('黑暗') && config.tags.includes('幽默')) {
    notes.push('在黑暗的底色中穿插黑色幽默的反差，让两者互相衬托。')
  }
  if (p.dialogue >= 70 && config.narration.viewpoint === 'first') {
    notes.push('第一人称下对话密集：叙述部分保持「我」的视角与口吻。')
  }
  return notes
}

/**
 * 组装【叙事风格】提示块。返回空串的唯一起因是调用方传入了空标签且
 * 全部参数等于默认（理论上不发生——默认配置也有措辞）。
 */
export function buildNarrativeStyleBlock(config: NstyleConfig): string {
  const lines: string[] = []
  for (const key of Object.keys(PARAM_PHRASES) as NstyleParamKey[]) {
    const phrase = PARAM_PHRASES[key][bandOf(config.params[key])]
    lines.push(`- ${NSTYLE_PARAM_META[key]}：${phrase}`)
  }
  const n = config.narration
  lines.push(`- 叙述视角：${VIEWPOINT_PHRASES[n.viewpoint] ?? ''}`)
  lines.push(`- 叙述时态：${TENSE_PHRASES[n.tense] ?? ''}`)
  lines.push(`- 内心独白：${MONOLOGUE_PHRASES[n.monologue] ?? ''}`)
  lines.push(`- 推进方式：${MODE_PHRASES[n.mode] ?? ''}`)
  lines.push(`- 篇幅：${LENGTH_PHRASES[n.length] ?? ''}`)
  lines.push(`- 人物刻画：${PORTRAYAL_PHRASES[n.portrayal] ?? ''}`)
  lines.push(`- 场景转换：${TRANSITION_PHRASES[n.transition] ?? ''}`)
  lines.push(`- 语言风格：${LANGUAGE_PHRASES[n.language] ?? ''}`)
  if (config.tags.length > 0) {
    lines.push(`- 整体基调标签：${config.tags.join('、')}——在用词、意象与场景选择上体现这些气质，允许自然组合`)
  }
  for (const note of harmonizeConflicts(config)) {
    lines.push(`- 协调：${note}`)
  }
  lines.push('- 以上只改变表达方式与叙事侧重：不得改写角色已确立的价值观、身份、关系与世界观事实')
  return `【叙事风格】\n${lines.join('\n')}`
}
