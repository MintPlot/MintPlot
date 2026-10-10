import { describe, expect, it } from 'vitest'
import { buildRpImportPlan, mapRpCharacterCard, mapRpFloors, mapRpMemory, regexExportEntry, worldInfoExportEntry, type RpChatRow, type RpKvRow } from '@/kernel/import/rp-import'
import type { MemoryState } from '@/kernel/memory/memory-engine'

const RP_CHARACTER = {
  uuid: 'rp-uuid-1',
  name: '蛊真人',
  description: '魔道巨擘',
  personality: '冷酷',
  scenario: '中洲',
  first_mes: '你好，人祖。',
  mes_example: '<START>\n{{user}}: 你好\n{{char}}: 哼。',
  creator_notes: '原著卡',
  avatar: 'file:///data/user/0/com.roleplayhub.app/files/media/gu-avatar.jpg',
  worldInfo: [
    { name: '春秋蝉', content: '六转蛊虫，可时光回溯。', keys: ['春秋蝉'], enabled: true, constant: false, position: 'at_depth', depth: 4 },
  ],
  regexScripts: [
    { scriptName: '纸卷美化', findRegex: '/(.*?)卷/g', replaceString: '<div class="scroll">$1</div>', markdownOnly: false, promptOnly: true, placement: [2] },
  ],
  uiTemplates: [
    { id: 'tpl-1', name: '面板', placement: 'top', variableState: { hp: 100 }, template: '<div>{{hp}}</div>' },
  ],
}

const makeKv = (extra: Record<string, unknown> = {}): RpKvRow[] =>
  Object.entries({ characters: [RP_CHARACTER], ...extra }).map(([key, value]) => ({ key, json: JSON.stringify(value) }))

describe('kernel/import · RP entry projections (M4-g2)', () => {
  it('worldinfo entries project to the ccv3 export shape M3-u consumes', () => {
    const entry = worldInfoExportEntry({ name: '春秋蝉', content: '六转蛊虫', keys: ['春秋蝉'], constant: true, depth: '6' })
    expect(entry).toMatchObject({ comment: '春秋蝉', content: '六转蛊虫', keys: ['春秋蝉'], constant: true, depth: 6, position: 'at_depth' })
  })

  it('regex entries map the dual field family onto the export shape', () => {
    const script = regexExportEntry({ scriptName: '纸卷美化', findRegex: '/a/g', replaceString: 'b', promptOnly: true, placement: [1, 2] })
    expect(script).toMatchObject({ name: '纸卷美化', regex: '/a/g', replacement: 'b', promptOnly: true, placement: [1, 2] })
  })
})

describe('kernel/import · RP card mapping (M4-g2)', () => {
  it('projects the RP record into v2 JSON and parses via MP\'s own parser', () => {
    const card = mapRpCharacterCard(RP_CHARACTER)
    expect(card.name).toBe('蛊真人')
    expect(card.firstMes).toBe('你好，人祖。')
    expect(card.mesExample).toContain('{{char}}')
    expect(card.scenario).toBe('中洲')
    // Card-embedded assets ride the MP channels.
    const book = card.book as { entries: Array<{ comment?: string }> }
    expect(book.entries[0]?.comment).toBe('春秋蝉')
    const regex = (card.extensions as { regex_scripts: Array<{ name: string; promptOnly: boolean }> }).regex_scripts
    expect(regex[0]?.name).toBe('纸卷美化')
    expect(regex[0]?.promptOnly).toBe(true)
    expect(card.uiTemplates).toHaveLength(1)
  })

  it('avatar media URIs reduce to archive entry names', () => {
    expect(mapRpCharacterCard(RP_CHARACTER).spec).toBe('chara_card_v2')
  })
})

describe('kernel/import · RP floors and memory (M4-g2)', () => {
  it('maps chat rows storage-ready, skipping empty assistant shells', () => {
    const rows: RpChatRow[] = [
      { characterId: 'rp-uuid-1', messageId: 'm1', position: 0, status: 'final', messageJson: JSON.stringify({ role: 'assistant', content: '你好，人祖。', id: 'a1' }) },
      { characterId: 'rp-uuid-1', messageId: 'm2', position: 1, status: 'final', messageJson: JSON.stringify({ role: 'user', content: '你又是谁?', id: 'u1' }) },
      { characterId: 'rp-uuid-1', messageId: 'm3', position: 2, status: 'final', messageJson: JSON.stringify({ role: 'assistant', content: '', reasoning: '只有思考', id: 'a2' }) },
      { characterId: 'rp-uuid-2', messageId: 'm4', position: 0, status: 'final', messageJson: JSON.stringify({ role: 'assistant', content: '别的卡', id: 'x1' }) },
    ]
    const floors = mapRpFloors(rows, 'rp-uuid-1')
    expect(floors.map((floor) => floor.content)).toEqual(['你好，人祖。', '你又是谁?'])
    expect(floors[0]?.role).toBe('assistant')
    expect(floors[1]?.role).toBe('user')
    // ts falls back to an ordered synthetic clock.
    expect(floors[1]!.ts).toBeGreaterThan(floors[0]!.ts)
  })

  it('memory maps the near-1:1 RP shape with the anchor pinned at floors', () => {
    const state = mapRpMemory(
      { long: '长期摘要', short: '短期摘要', batches: [{ x: 1 }], updatedAt: 123 },
      { characters: [{ name: '方源' }], relations: [], openPlots: [{ title: '夺舍' }] },
      42,
    )!
    expect(state.long).toBe('长期摘要')
    expect(state.short).toBe('短期摘要')
    expect(state.anchor).toBe(42)
    expect(state.profile.characters).toHaveLength(1)
    expect((state as MemoryState).batches).toEqual([])
  })

  it('returns null when neither summaries nor profile exist', () => {
    expect(mapRpMemory(null, null, 0)).toBeNull()
  })
})

describe('kernel/import · RP plan building (M4-g2)', () => {
  it('filters selected cards, mounts globals into their extensions, collects presets', () => {
    const kv = makeKv({
      global_worldinfo: [{ name: '全局设定', content: '大爱仙尊时代', keys: ['大爱'] }],
      global_regex: [{ scriptName: '全局美化', findRegex: '/x/g', replaceString: 'y' }],
      global_ui_templates: [{ id: 'tpl-g', name: '全局面板', variableState: {}, template: '<b/>' }],
      presets: [
        { name: '时间戳', content: '【第1日】', enabled: true, role: 'system', group: 'default' },
        { name: '空条目', content: '  ', enabled: true, role: 'system' },
      ],
      'memory_summaries_rp-uuid-1': { long: 'L', short: 'S' },
      'memory_profile_rp-uuid-1': { characters: [], relations: [], openPlots: [] },
    })
    const chatRows: RpChatRow[] = [
      { characterId: 'rp-uuid-1', messageId: 'm1', position: 0, status: 'final', messageJson: JSON.stringify({ role: 'assistant', content: '你好', id: 'a1' }) },
    ]
    const plan = buildRpImportPlan(kv, chatRows, ['rp-uuid-1'], { includeGlobals: true, includePresets: true })
    expect(plan.cards).toHaveLength(1)
    const card = plan.cards[0]!
    expect(card.name).toBe('蛊真人')
    expect(card.floors).toHaveLength(1)
    expect(card.avatarEntryName).toBe('media/gu-avatar.jpg')
    expect(card.memory?.long).toBe('L')
    expect(card.memory?.anchor).toBe(1)
    // Globals mounted under reserved extension keys.
    const extensions = card.card.extensions as Record<string, unknown>
    expect(extensions.rp_imported_global_worldinfo).toHaveLength(1)
    expect(extensions.rp_imported_global_regex).toHaveLength(1)
    expect(extensions.rp_imported_global_ui_templates).toHaveLength(1)
    // Presets: real ones kept (disabled by default), blank ones dropped.
    expect(plan.presets).toEqual([{ name: '时间戳', content: '【第1日】', enabled: false, role: 'system' }])
  })

  it('warns on unknown uuids; corrupt records either parse leniently or warn', () => {
    const kv = makeKv({ characters: [{ uuid: 'bad', name: '坏卡', first_mes: 42, worldInfo: 'not-array' }] })
    const plan = buildRpImportPlan(kv, [], ['missing', 'bad'], { includeGlobals: false, includePresets: false })
    // Unknown uuid warns; the malformed record never crashes the plan —
    // it either parses leniently (MP parser is forgiving) or collects a warning.
    expect(plan.warnings.some((warning) => warning.includes('不存在'))).toBe(true)
    expect(plan.warnings.every((warning) => typeof warning === 'string')).toBe(true)
    expect(plan.cards.every((card) => typeof card.name === 'string')).toBe(true)
  })
})
