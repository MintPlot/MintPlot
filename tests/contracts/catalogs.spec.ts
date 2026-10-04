import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  PIPELINE_POINTS,
  PROMPT_SEGMENT_ORDER,
  PUBLIC_SEAM_IDS,
  SESSION_EVENT_TYPES,
  TRANSIENT_EVENT_TYPES,
} from '../../contracts/extension-points'
import { SESSION_KINDS } from '../../contracts/session-kind'
import {
  CARD_PANEL_SECTION_PERMISSION,
  CARD_VARIABLES_EXTENSION_KEY,
  VARIABLE_EXPAND_POINT,
  VARIABLE_SET_EVENT_TYPE,
} from '../../contracts/variables'
import type { VariableValue } from '../../contracts/variables'
import type {
  MessageEditedEvent,
  SessionEvent,
  VariableSetEvent,
} from '../../contracts/extension-points'

describe('session kinds (spec v1.2 §03)', () => {
  it('declares exactly the two domains', () => {
    expect([...SESSION_KINDS]).toEqual(['chatbox', 'card'])
  })
})

describe('pipeline points (R-08)', () => {
  it('fixes the prompt segment order — worldinfo, memory, preset, cot, regex', () => {
    expect([...PROMPT_SEGMENT_ORDER]).toEqual([
      'prompt.worldinfo',
      'prompt.memory',
      'prompt.preset',
      'prompt.cot',
      'prompt.regex',
    ])
  })

  it('places the reserved variable-expand point before all prompt segments', () => {
    const expandIndex = PIPELINE_POINTS.indexOf(VARIABLE_EXPAND_POINT)
    const worldInfoIndex = PIPELINE_POINTS.indexOf('prompt.worldinfo')
    expect(expandIndex).toBeGreaterThanOrEqual(0)
    expect(expandIndex).toBeLessThan(worldInfoIndex)
  })

  it('exposes exactly the v1 point set, each once', () => {
    expect([...PIPELINE_POINTS]).toEqual([
      'variable-expand',
      'input.transform',
      ...PROMPT_SEGMENT_ORDER,
      'response.transform',
      'chat.render',
    ])
  })
})

describe('session events (R-07 + variable reservation)', () => {
  it('lists the six ADR v1 event types plus variable.set', () => {
    expect([...SESSION_EVENT_TYPES]).toEqual([
      'message.appended',
      'message.deleted',
      'message.edited',
      'swipe.selected',
      'branch.created',
      'projection.registered',
      VARIABLE_SET_EVENT_TYPE,
    ])
  })

  it('keeps variable.set reservable and named exactly as ratified', () => {
    expect(VARIABLE_SET_EVENT_TYPE).toBe('variable.set')
    expect(VARIABLE_EXPAND_POINT).toBe('variable-expand')
  })

  it('narrows the event union by kind (type level)', () => {
    expectTypeOf<SessionEvent>().toExtend<{ kind: string }>()
    expectTypeOf<MessageEditedEvent['kind']>().toEqualTypeOf<'message.edited'>()
    expectTypeOf<VariableSetEvent['source']>().toEqualTypeOf<'ai' | 'manual' | 'regex'>()
    // M3-r widened VariableValue with nested JSON trees (ui-template
    // replacement); `after` rides the widened type.
    expectTypeOf<VariableSetEvent['after']>().toEqualTypeOf<VariableValue | null>()
  })
})

describe('transient events (§4.4)', () => {
  it('lists exactly the v1 transient types', () => {
    expect([...TRANSIENT_EVENT_TYPES]).toEqual([
      'chat.started',
      'chat.switched',
      'seam.provider.changed',
      'plugin.state.changed',
      'app.resume',
      'app.pause',
      // M4-c: the kernel chat page asks the tts plugin to toggle floor reading.
      'tts.speak.requested',
    ])
  })
})

describe('capability seams (R-09)', () => {
  it('opens exactly the three public seams in contract v1', () => {
    expect([...PUBLIC_SEAM_IDS]).toEqual(['llm.provider', 'tts.engine', 'image.gen'])
  })

  it('keeps internal seams (turn.driver / embedder) outside the public catalog', () => {
    expect(PUBLIC_SEAM_IDS).not.toContain('turn.driver')
    expect(PUBLIC_SEAM_IDS).not.toContain('embedder')
  })
})

describe('card panel slot reservation (review v1.0 D1)', () => {
  it('reserves the permission id with the ratified name', () => {
    expect(CARD_PANEL_SECTION_PERMISSION).toBe('card.panel.section')
  })

  it('pins the card default-value extension key (D4)', () => {
    expect(CARD_VARIABLES_EXTENSION_KEY).toBe('mp_variables')
  })
})
