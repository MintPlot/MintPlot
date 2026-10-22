/**
 * IME composition guard regression pin — the guard has been silently lost
 * twice in composer refactors (492a264 added it, 711ce5f dropped it, the
 * motion batch inherited the loss). On Chromium an IME's Enter-confirm
 * arrives as keydown Enter with isComposing=true (legacy: keyCode 229):
 * that Enter must NOT send the draft, or raw pinyin ships as a message and
 * the half-composed draft plus pending one-shot/attachments are consumed.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatComposer from '@/kernel/app/chat/ChatComposer.vue'

const mountComposer = () =>
  mount(ChatComposer, {
    props: {
      pendingImages: [],
      draft: 'nihao',
      streaming: false,
      oneShotInstruction: '',
      sendDisabled: false,
    },
  })

const enterEvent = (overrides?: { keyCode?: number; isComposing?: boolean }): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  })
  // KeyboardEventInit exposes isComposing in the dictionary, but jsdom's
  // constructor may ignore it — define both signals defensively so the pin
  // exercises the real guard branches.
  if (overrides?.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', { value: overrides.isComposing })
  }
  if (overrides?.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: overrides.keyCode })
  }
  return event
}

describe('ChatComposer IME composition guard', () => {
  it('Enter with isComposing=true does not send (candidate confirm)', () => {
    const wrapper = mountComposer()
    wrapper.get('textarea').element.dispatchEvent(enterEvent({ isComposing: true }))
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('Enter with legacy keyCode 229 does not send', () => {
    const wrapper = mountComposer()
    wrapper.get('textarea').element.dispatchEvent(enterEvent({ keyCode: 229 }))
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('plain Enter sends exactly once and is preventDefaulted', () => {
    const wrapper = mountComposer()
    const event = enterEvent()
    wrapper.get('textarea').element.dispatchEvent(event)
    expect(wrapper.emitted('send')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
