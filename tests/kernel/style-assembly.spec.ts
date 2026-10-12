import { describe, expect, it } from 'vitest'
import { resolveStyleBlock, renderStyleBlock, type CardStyleSelection } from '@/kernel/presets/style-assembly'
import type { PresetEntry, PresetSnapshot } from '@/kernel/presets/preset-store'
import { createRequestAssembler, type RequestAssemblerDeps } from '@/kernel/app/chat/request-assembly'

const entry = (id: string, name: string, extra: Partial<PresetEntry> = {}): PresetEntry => ({
  id,
  name,
  content: `${name}的内容`,
  enabled: false,
  role: 'system',
  group: 'default',
  ...extra,
})

const baseSnapshot = (): PresetSnapshot => ({
  groups: [
    { id: 'g1', name: '默认预设', builtin: true, enabled: true },
    { id: 'g2', name: '另一方案', builtin: false, enabled: false },
  ],
  entries: [
    entry('plain', '时间戳', { enabled: true, group: 'g1' }),
    entry('person3', '第三人称', { dimension: 'person', enabled: true, group: 'g1' }),
    entry('person2', '第二人称', { dimension: 'person', enabled: false, group: 'g1' }),
    entry('w1', '写法·甲', { dimension: 'writing', enabled: true, group: 'g1' }),
    entry('len', '篇幅·细腻', { dimension: 'length', enabled: true, group: 'g2' }),
    entry('mood1', '轻松幽默', { dimension: 'mood', enabled: true, group: 'g1' }),
    entry('mood2', '紧张悬疑', { dimension: 'mood', enabled: true, group: 'g1' }),
    entry('nsfw1', 'NSFW·直白', { dimension: 'nsfw', enabled: true, group: 'g1' }),
    entry('cardpick', '卡选风格', { dimension: 'style', enabled: false, group: 'g2' }),
  ],
})

const positions = (text: string, names: string[]): number[] => names.map((name) => text.indexOf(`[${name}]`))

describe('resolveStyleBlock (S2, planning style-dimension-presets-plan)', () => {
  it('global 模式:仅激活组内启用的维度条目,按固定维度序排列', () => {
    const items = resolveStyleBlock(baseSnapshot(), null, true)
    expect(items.map((item) => item.entry!.name)).toEqual(['第三人称', '写法·甲', '轻松幽默', '紧张悬疑', 'NSFW·直白'])
    expect(items.every((item) => item.source === 'global')).toBe(true)
  })

  it('每卡覆盖:跨组按 id 取条目,无视库内启停;chatbox 域无视覆盖读全局', () => {
    const selection: CardStyleSelection = {
      followGlobal: false,
      picks: { person: ['person2'], style: ['cardpick'] },
    }
    const cardItems = resolveStyleBlock(baseSnapshot(), selection, true)
    expect(cardItems.map((item) => item.entry!.name)).toEqual(['第二人称', '卡选风格'])
    expect(cardItems.every((item) => item.source === 'card')).toBe(true)

    const chatboxItems = resolveStyleBlock(baseSnapshot(), selection, false)
    expect(chatboxItems.map((item) => item.entry!.name)).toContain('第三人称')
    expect(chatboxItems.map((item) => item.entry!.name)).not.toContain('卡选风格')
  })

  it('单选维度截断至 1,悬空 pick 标记 missing,多选维度全收', () => {
    const selection: CardStyleSelection = {
      followGlobal: false,
      picks: { person: ['person2', 'person3'], nsfw: ['ghost'], mood: ['mood1', 'mood2'] },
    }
    const items = resolveStyleBlock(baseSnapshot(), selection, true)
    expect(items.filter((item) => item.dimension === 'person').map((item) => item.entry!.name)).toEqual(['第二人称'])
    const nsfw = items.filter((item) => item.dimension === 'nsfw')
    expect(nsfw).toHaveLength(1)
    expect(nsfw[0]).toMatchObject({ missing: true, entry: null })
    expect(items.filter((item) => item.dimension === 'mood')).toHaveLength(2)
  })
})

describe('renderStyleBlock', () => {
  it('固定维度序 + [名]\\n内容 格式,跳过悬空与空内容', () => {
    const snapshot = baseSnapshot()
    const withBlank: PresetSnapshot = {
      ...snapshot,
      entries: [...snapshot.entries, entry('blank', '空条目', { dimension: 'length', content: '  ' })],
    }
    const items = resolveStyleBlock(
      withBlank,
      { followGlobal: false, picks: { nsfw: ['nsfw1'], person: ['person3'], writing: ['w1'], length: ['blank'], mood: ['ghost'] } },
      true,
    )
    // A deleted pick survives resolution as a missing item (disclosure only).
    expect(items.find((item) => item.missing)).toMatchObject({ dimension: 'mood', entry: null })
    const rendered = renderStyleBlock(items)
    const [person, writing, nsfw] = positions(rendered, ['第三人称', '写法·甲', 'NSFW·直白'])
    expect(person).toBeGreaterThanOrEqual(0)
    expect(person).toBeLessThan(writing)
    expect(writing).toBeLessThan(nsfw)
    expect(rendered).toContain('[第三人称]\n第三人称的内容')
    // Blank-content entries and deleted picks inject nothing.
    expect(rendered).not.toContain('[空条目]')
    expect(rendered).not.toContain('ghost')
  })
})

function makeDeps(overrides: Partial<RequestAssemblerDeps> = {}): RequestAssemblerDeps {
  return {
    settingsState: null,
    presetStore: null,
    isCardDomain: () => false,
    card: () => null,
    conversation: () => ({ id: 'c1', title: '会话', systemPrompt: '基础人设', createdAt: 0, updatedAt: 0 } as never),
    messages: () => [],
    memoryActive: () => false,
    memoryState: () => null,
    presetsActive: () => true,
    presetSnapshot: () => baseSnapshot(),
    setPresetSnapshot: () => {},
    cotActive: () => false,
    variablesActive: () => false,
    variableState: () => ({}),
    activeTemplates: () => [],
    templateStateOf: () => ({}),
    worldbookActive: () => false,
    worldbookDisabledUids: () => new Set(),
    regexActive: () => false,
    onWorldbookArtifact: () => {},
    cardRegexScripts: () => [],
    regexDisabledUids: () => new Set(),
    activeVisionCapable: () => false,
    oneShotInstruction: () => '',
    readUserInfo: () => ({ name: '用户', persona: '' }),
    macroContext: () => ({ charName: '角色', userName: '用户' }),
    ...overrides,
  }
}

describe('buildRequestMessages dimension block (S2 integration)', () => {
  it('维度块紧跟非维度条目、先于基础系统提示,维度间按固定序', () => {
    const assembler = createRequestAssembler(makeDeps())
    const result = assembler.buildRequestMessages()
    const system = result[0]!.content as string
    const [plain, person, writing, mood, nsfw] = positions(system, ['时间戳', '第三人称', '写法·甲', '轻松幽默', 'NSFW·直白'])
    const base = system.indexOf('基础人设')
    expect(plain).toBeGreaterThanOrEqual(0)
    expect(plain).toBeLessThan(person)
    expect(person).toBeLessThan(writing)
    expect(writing).toBeLessThan(mood)
    expect(mood).toBeLessThan(nsfw)
    expect(nsfw).toBeLessThan(base)
  })

  it('卡域覆盖:注入本卡 picks(跨组、无视启停),不再注入全局激活组条目', () => {
    const assembler = createRequestAssembler(makeDeps({
      isCardDomain: () => true,
      cardStyle: () => ({ followGlobal: false, picks: { person: ['person2'], style: ['cardpick'] } }),
    }))
    const system = assembler.buildRequestMessages()[0]!.content as string
    expect(system).toContain('[第二人称]')
    expect(system).toContain('[卡选风格]')
    expect(system).not.toContain('[第三人称]')
    expect(system).not.toContain('[写法·甲]')
  })

  it('followGlobal(默认)与 chatbox 域一致读全局;presets 插件停用整层休眠', () => {
    const following = createRequestAssembler(makeDeps({ isCardDomain: () => true, cardStyle: () => ({ followGlobal: true, picks: {} }) }))
    expect(following.buildRequestMessages()[0]!.content).toContain('[第三人称]')

    const dormant = createRequestAssembler(makeDeps({ presetsActive: () => false }))
    expect(dormant.buildRequestMessages()[0]!.content).toBe('基础人设')
  })

  it('带维度的 user 角色条目改走维度块(system 通道),不再成为 prefill 独立消息', () => {
    const snapshot = baseSnapshot()
    snapshot.entries.push(entry('tagged', '被标维度', { dimension: 'mood', enabled: true, role: 'user', group: 'g1' }))
    const assembler = createRequestAssembler(makeDeps({ presetSnapshot: () => snapshot }))
    const result = assembler.buildRequestMessages()
    expect(result.some((message) => message.role === 'user' && message.content === '被标维度的内容')).toBe(false)
    expect((result[0]!.content as string)).toContain('[被标维度]')
  })
})
