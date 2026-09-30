import { describe, expect, it } from 'vitest'
import { buildCardSystemPrompt, greetingFloorMissing } from '@/kernel/characters/card-prompt'

const CARD = { name: '星澜', personality: '温柔而坚定', mesExample: '' }
const USER = { name: '阿辰', persona: '一个旅人' }

describe('card prompt · RP minimal assembly (M3-i)', () => {
  it('builds the [Character] block with the [User Info] block moved to the end', () => {
    expect(buildCardSystemPrompt(CARD, USER)).toBe([
      '[Character]',
      '',
      'Name: 星澜',
      'Personality: 温柔而坚定',
      '',
      '[User Info]',
      'Name: 阿辰',
      'Description: 一个旅人',
    ].join('\n'))
  })

  it('appends mes_example only when non-empty (whitespace-only counts as empty)', () => {
    const withExample = buildCardSystemPrompt({ ...CARD, mesExample: '<START>\n{{user}}: 你好\n{{char}}: 嗯。' }, USER)
    expect(withExample).toContain('Personality: 温柔而坚定\n\n<START>\n{{user}}: 你好\n{{char}}: 嗯。')

    const without = buildCardSystemPrompt(CARD, USER)
    expect(without).not.toContain('<START>')
    expect(buildCardSystemPrompt({ ...CARD, mesExample: '   \n  ' }, USER)).toBe(without)
  })

  it('renders empty user fields RP-style: the block shape survives', () => {
    expect(buildCardSystemPrompt(CARD, { name: '', persona: '' })).toBe([
      '[Character]',
      '',
      'Name: 星澜',
      'Personality: 温柔而坚定',
      '',
      '[User Info]',
      'Name: ',
      'Description: ',
    ].join('\n'))
  })

  it('description and scenario never enter the prompt (user-facing fields)', () => {
    const full = { ...CARD, description: '给用户看的简介', scenario: '某个场景设定' }
    const prompt = buildCardSystemPrompt(full, USER)
    expect(prompt).not.toContain('给用户看的简介')
    expect(prompt).not.toContain('某个场景设定')
  })
})

describe('card prompt · greeting insurance (RP behavior)', () => {
  const greeting = '你好，旅人。'

  it('flags when the history does not open with the greeting', () => {
    expect(greetingFloorMissing([], greeting)).toBe(true)
    expect(greetingFloorMissing([{ role: 'user', content: greeting }], greeting)).toBe(true)
    expect(greetingFloorMissing([{ role: 'assistant', content: '被改过的首楼' }], greeting)).toBe(true)
    expect(greetingFloorMissing([{ role: 'assistant', content: greeting }], greeting)).toBe(false)
  })

  it('an empty greeting never needs injection', () => {
    expect(greetingFloorMissing([], '')).toBe(false)
  })
})
