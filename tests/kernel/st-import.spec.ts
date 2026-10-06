import { describe, expect, it } from 'vitest'
import { detectBackupSource, classifyLooseJson } from '@/kernel/import/backup-source'
import { classifyStEntryName, classifyStJson, mapStPreset, mapStRegex, mapStWorldbook } from '@/kernel/import/st-import'

describe('kernel/import · backup source detection (M4-g2)', () => {
  it('detects RP backups by manifest format or database/ entries', () => {
    expect(detectBackupSource([{ name: 'manifest.json', size: 1 }, { name: 'database/RoleplayDatabase', size: 1 }], 'roleplay-hub-backup')).toBe('rp')
    expect(detectBackupSource([{ name: 'database/RoleplayDatabase', size: 1 }], null)).toBe('rp')
  })

  it('detects ST backups by directory shape and rejects strangers', () => {
    expect(detectBackupSource([{ name: 'worlds/mybook.json', size: 1 }, { name: 'characters/a.png', size: 1 }], null)).toBe('st')
    expect(detectBackupSource([{ name: 'random/thing.bin', size: 1 }], null)).toBeNull()
  })
})

describe('kernel/import · ST asset classification (M4-g2)', () => {
  it('content-sniffs loose JSONs into the four kinds', () => {
    expect(classifyStJson({ entries: { '0': { content: 'x' } } })).toBe('worldbook')
    expect(classifyStJson({ prompts: [{ name: 'p', content: 'c' }] })).toBe('preset')
    expect(classifyStJson({ scriptName: 's', findRegex: '/a/g', replaceString: 'b' })).toBe('regex')
    expect(classifyStJson({ spec: 'chara_card_v2', data: {} })).toBe('character')
    expect(classifyStJson({ name: '卡', description: '描述', first_mes: '开场' })).toBe('character')
    expect(classifyStJson({ hello: true })).toBe('unknown')
    expect(classifyLooseJson({ entries: {} })).toBe('worldbook')
  })

  it('directory names classify zip entries; chats are out of scope', () => {
    expect(classifyStEntryName('worlds/book.json')).toBe('worldbook')
    expect(classifyStEntryName('regex/scripts.json')).toBe('regex')
    expect(classifyStEntryName('presets/openai/p.json')).toBe('preset')
    expect(classifyStEntryName('characters/card.png')).toBe('character')
    expect(classifyStEntryName('chats/c.jsonl')).toBe('unknown')
  })
})

describe('kernel/import · ST mappings (M4-g2)', () => {
  it('worldbook entries-object converts to the entries array container verbatim', () => {
    const book = mapStWorldbook({ entries: { '0': { uid: 0, key: ['a'], content: '甲', comment: '条目甲' }, '1': { uid: 1, key: ['b'], content: '乙' } } })
    expect(book.entries).toHaveLength(2)
    expect((book.entries[0] as { comment: string }).comment).toBe('条目甲')
  })

  it('regex single-or-list files pass through the dual field family', () => {
    const single = mapStRegex({ scriptName: 's', findRegex: '/a/g', replaceString: 'b' })
    expect(single).toHaveLength(1)
    expect(single[0]).toMatchObject({ scriptName: 's' })
    const list = mapStRegex([{ scriptName: 'a', findRegex: 'x', replaceString: 'y' }, { unrelated: true }])
    expect(list).toHaveLength(1)
  })

  it('presets map lossily with the fidelity notes disclosed', () => {
    const mapped = mapStPreset({
      prompts: [
        { identifier: 'main', name: '主要', role: 'system', content: '正文A', position: 0 },
        { identifier: 'chatHistory', name: '聊天历史', role: 'system', content: '', marker: true },
        { identifier: 'nsfw', name: '增强', role: 'system', content: '正文B' },
      ],
      prompt_order: { '100000': [{ identifier: 'main', enabled: true }, { identifier: 'nsfw', enabled: false }] },
    })
    expect(mapped.entries.map((entry) => entry.name)).toEqual(['主要', '增强'])
    expect(mapped.entries[0]).toMatchObject({ content: '正文A', enabled: true, role: 'system' })
    expect(mapped.entries[1]?.enabled).toBe(false)
    expect(mapped.notes.some((note) => note.includes('聊天历史'))).toBe(true)
    expect(mapped.notes.some((note) => note.includes('有损'))).toBe(true)
  })
})
