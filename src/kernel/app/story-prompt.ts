/**
 * 故事引擎提示块(M4-e) — 叙事原则 + 关系阶段表 + 阶段记账规则的纯组装器。
 *
 * 配置存 mp_settings 普通键(storyPrinciples / storyStages / storyBookkeeping,
 * 由 HOST 注册的 StorySettings 面板写入);当前阶段值来自变量账本的 `stage`
 * 变量(卡域,经既有 setvars 解析落账)。块由 ChatSessionView 拼进系统提示
 * 尾部——放在变量区之后,模型每轮都能看到当前阶段并按表行事。
 * 纯函数:无框架依赖,方便单测。
 */

export interface StoryStage {
  name: string
  guide: string
}

export interface StoryPromptConfig {
  /** 叙事原则(反顺从):角色自主权、拒绝方式、后果延续、不代用户行动。 */
  principles: string
  /** 关系阶段表(有序):阶段名 + 该阶段的行为/语气描述。空 = 不注入阶段系统。 */
  stages: StoryStage[]
  /** 阶段记账:注入「跃迁时输出 setvars」的指令(需要变量账本解析,仅卡域)。 */
  bookkeeping: boolean
}

/**
 * 阶段变量名(账本里就是这个名字;setvars 更新它)。带命名空间前缀:模板 id
 * 由卡片作者任意起名,裸名 `stage` 与之相撞会让两套系统在账本里互写覆写。
 */
export const STORY_STAGE_VARIABLE = 'story.stage'

export const DEFAULT_STORY_PRINCIPLES = [
  '你始终以角色身份行动，不是有求必应的助手。',
  '你拥有独立的目标、情绪和底线：对不符合性格的要求，以角色的方式回应——质疑、拖延、讨价还价、明确拒绝，并给出基于你经历的理由。',
  '拒绝之后推动剧情：提出你的条件或替代方案，让冲突继续。',
  '后果是延续的：之前的冲突、承诺和恩怨会影响你现在的态度。',
  '永远不要代替 {{user}} 说话、思考或行动；只描写你角色的言行和周围环境的变化。',
  '每次回复推进一点剧情（时间、地点或事件）。',
].join('\n')

export const DEFAULT_STORY_STAGES: StoryStage[] = [
  { name: '初识', guide: '防备、简短、多用「您」；拒绝隐私打探，帮忙要条件' },
  { name: '熟悉', guide: '放松、会开玩笑、直呼其名；小忙肯帮，大事要交换' },
  { name: '亲近', guide: '主动分享秘密、语气软、有肢体语言' },
  { name: '交付', guide: '袒露脆弱面、愿意为对方破例' },
]

/** 容错解析持久化的阶段表(字符串 JSON 或已解析数组;脏数据静默降级为空)。 */
export function parseStoryStages(raw: unknown): StoryStage[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const stages: StoryStage[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = String((entry as { name?: unknown }).name ?? '').trim()
    const guide = String((entry as { guide?: unknown }).guide ?? '').trim()
    if (name) stages.push({ name, guide })
  }
  return stages
}

/**
 * 组装提示块;三部分全空(或阶段表为空)时返回 ''(调用方跳过注入)。
 * currentStage 为空串时阶段表标注首个阶段为当前。
 */
export function buildStoryPromptBlock(config: StoryPromptConfig, currentStage: string): string {
  const parts: string[] = []
  const principles = config.principles.trim()
  if (principles) parts.push(`【叙事原则】\n${principles}`)
  if (config.stages.length > 0) {
    const active = config.stages.some((stage) => stage.name === currentStage)
      ? currentStage
      : config.stages[0]!.name
    const lines = config.stages.map((stage) => {
      const marker = stage.name === active ? '（当前）' : ''
      return `- ${stage.name}${marker}：${stage.guide}`
    })
    parts.push(`【关系阶段】当前阶段：${active}\n${lines.join('\n')}`)
  }
  if (config.bookkeeping && config.stages.length > 0) {
    const order = config.stages.map((stage) => stage.name).join(' → ')
    // NOTE: the instruction must NOT contain the literal variable-tag syntax
    // (<setvars>) — the request pipeline is asserted tag-free (M3-s 双剥),
    // and tags are an OUTPUT convention the model already knows from the
    // variables system.
    parts.push(
      [
        '【阶段记账】',
        '- 平时不要输出任何变量更新；只有当这轮互动构成阶段跃迁时，才在回复最末尾用变量系统的更新块语法（左尖括号 + setvars + 右尖括号包裹 JSON）输出一次：' +
          `${STORY_STAGE_VARIABLE} = 下一阶段名`,
        `- 阶段顺序：${order}；跃迁必须有事件支撑，禁止跳级`,
        '- 变量是剧情内部信息，回复正文永远不要提及',
      ].join('\n'),
    )
  }
  if (parts.length === 0) return ''
  return parts.join('\n\n')
}
