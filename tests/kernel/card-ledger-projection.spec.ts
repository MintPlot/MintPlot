import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref, shallowRef } from 'vue'
import type { VariableSetEvent } from '@contracts'
import type { CharacterCard, CardUiTemplate } from '@/kernel/characters/character-card'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { useCardLedger } from '@/kernel/app/chat/use-card-ledger'

const event = (after: number, candidateIndex?: number): VariableSetEvent => ({
  id: `e-${after}`, kind: 'variable.set', pluginId: 'variables', sessionId: 'card', sessionKind: 'card',
  name: 'panel', before: null, after: { n: after }, source: 'ai', ts: after,
  messageId: 'm-1', ...(candidateIndex === undefined ? {} : { candidateIndex }),
})

function fixture() {
  const scope = effectScope()
  const messages = ref<ChatboxMessage[]>([{
    id: 'm-1', role: 'assistant', content: 'hello', ts: 1,
    candidates: ['a', 'b'], activeIndex: 0,
  }])
  const template: CardUiTemplate = {
    id: 'panel', name: 'Panel', enabled: true, scope: 'character', order: 0, placement: 'top',
    htmlTemplate: '<b>value={{n}}</b>', initialVariableState: { n: 0 }, variableSchema: '',
  }
  const card = shallowRef({ id: 'card', uiTemplates: [template] } as CharacterCard)
  const ledger = scope.run(() => useCardLedger({
    settingsState: null, variableStore: null, worldbookStore: null, regexStore: null, recordUsage: null,
    isCardDomain: () => true, card: () => card.value, messages: () => messages.value,
    isStreamingFloor: () => false, toProse: x => x, userName: () => 'User', userInfoLine: () => '',
  }))!
  const projectedHtml = computed(() => ledger.floorPanels(messages.value[0]!).top[0]?.html ?? '')
  const html = () => projectedHtml.value
  return { scope, messages, card, template, ledger, html }
}

describe('card ledger derived projections', () => {
  it('reprojects a historical floor after message positions change', () => {
    const f = fixture()
    const floor = f.messages.value[0]!
    f.messages.value.push({ id: 'm-2', role: 'assistant', content: 'new', ts: 2 })
    f.ledger.variableEvents.value = [event(10), { ...event(20), messageId: 'm-2' }]
    const projected = computed(() => f.ledger.floorPanels(floor).top[0]?.html)
    expect(projected.value).toContain('value=10')
    f.messages.value.reverse()
    expect(projected.value).toContain('value=20')
    f.scope.stop()
  })
  it('does not rebuild historical HTML after append even when visible panels exceed the HTML LRU', () => {
    const f = fixture()
    f.card.value = { ...f.card.value, uiTemplates: Array.from({ length: 3 }, (_, i) => ({ ...f.template, id: `panel-${i}` })) }
    f.messages.value = Array.from({ length: 20 }, (_, i) => ({ id: `m-${i}`, role: 'assistant', content: 'synthetic', ts: i }))
    f.ledger.variableEvents.value = f.messages.value.flatMap((message, i) => Array.from({ length: 3 }, (_, j) => ({
      ...event(i), id: `e-${i}-${j}`, name: `panel-${j}`, messageId: message.id,
    })))
    const panels = f.messages.value.map(f.ledger.floorPanels)
    const create = vi.spyOn(document, 'createElement')
    f.messages.value.push({ id: 'tail', role: 'assistant', content: 'new', ts: 21 })
    f.ledger.variableEvents.value = [...f.ledger.variableEvents.value, { ...event(99), name: 'panel-0', messageId: 'tail' }]
    for (let i = 0; i < 20; i++) expect(f.ledger.floorPanels(f.messages.value[i]!)).toBe(panels[i])
    expect(create).not.toHaveBeenCalled()
    create.mockRestore()
    f.scope.stop()
  })
  it('invalidates a panel when switching candidates without changing event counts', () => {
    const f = fixture()
    f.ledger.variableEvents.value = [event(10, 0), event(20, 1)]
    expect(f.html()).toContain('value=10')
    f.messages.value[0]!.activeIndex = 1
    expect(f.html()).toContain('value=20')
    expect(f.ledger.floorVariableSummary(f.messages.value[0]!).total).toBe(1)
    f.scope.stop()
  })

  it('invalidates equal-length ledger replacement and edited template HTML', () => {
    const f = fixture()
    f.ledger.variableEvents.value = [event(10)]
    expect(f.html()).toContain('value=10')
    f.ledger.variableEvents.value = [event(30)]
    expect(f.html()).toContain('value=30')
    f.card.value = { ...f.card.value, uiTemplates: [{ ...f.template, htmlTemplate: '<b>edited={{n}}</b>' }] }
    expect(f.html()).toContain('edited=30')
    f.scope.stop()
  })

  it('keeps unchanged historical panel HTML stable after append and reset', () => {
    const f = fixture()
    f.ledger.variableEvents.value = [event(10)]
    const prior = f.html()
    f.messages.value.push({ id: 'm-2', role: 'assistant', content: 'new', ts: 2 })
    f.ledger.variableEvents.value = [...f.ledger.variableEvents.value, { ...event(40), messageId: 'm-2' }]
    expect(f.html()).toBe(prior)
    f.ledger.variableEvents.value = []
    expect(f.html()).toContain('value=0')
    f.ledger.variablesActive.value = false
    expect(f.html()).toBe('')
    f.scope.stop()
  })
})
