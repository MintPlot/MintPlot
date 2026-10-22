import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ChatComposer from '@/kernel/app/chat/ChatComposer.vue'

let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())

function enter(options: { isComposing?: boolean; keyCode?: number; shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, shiftKey: options.shiftKey })
  Object.defineProperties(event, {
    isComposing: { value: options.isComposing ?? false }, keyCode: { value: options.keyCode ?? 13 },
  })
  wrapper = mount(ChatComposer, { props: {
    draft: 'nihao', pendingImages: [], streaming: false, oneShotInstruction: 'Synthetic instruction', sendDisabled: false,
  } })
  wrapper.get('textarea').element.dispatchEvent(event)
  return event
}

describe('composer Enter handling', () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])('preserves IME confirmation and the draft: %o', (options) => {
    const event = enter(options)
    expect(wrapper!.emitted('send')).toBeUndefined()
    expect(wrapper!.emitted('update:draft')).toBeUndefined()
    expect(wrapper!.emitted('update:oneShotInstruction')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
    expect(wrapper!.get('textarea').element.value).toBe('nihao')
  })
  it('sends once and prevents a newline on plain Enter', () => {
    const event = enter()
    expect(wrapper!.emitted('send')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
  })
  it('leaves Shift+Enter available for a newline', () => {
    const event = enter({ shiftKey: true })
    expect(wrapper!.emitted('send')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })
})
