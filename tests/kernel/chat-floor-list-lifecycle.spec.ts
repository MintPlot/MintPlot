import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Virtualizer } from '@tanstack/vue-virtual'
import ChatFloorList from '@/kernel/app/chat/ChatFloorList.vue'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { FloorView } from '@/kernel/app/chat/floor-view'

const harness = vi.hoisted(() => ({ instances: [] as Virtualizer<Element, Element>[] }))
vi.mock('@tanstack/vue-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/vue-virtual')>()
  return { ...actual, useVirtualizer: (...args: Parameters<typeof actual.useVirtualizer>) => {
    const result = actual.useVirtualizer(...args)
    harness.instances.push(result.value)
    return result
  } }
})

afterEach(() => { harness.instances.length = 0; document.body.replaceChildren(); vi.restoreAllMocks() })

describe('virtual floor measurement lifecycle', () => {
  it('unobserves and drops detached rows after Vue removes function refs', async () => {
    const viewport = document.createElement('div')
    Object.defineProperties(viewport, {
      clientHeight: { value: 600 }, clientWidth: { value: 360 }, offsetHeight: { value: 600 }, offsetWidth: { value: 360 },
    })
    viewport.scrollTo = vi.fn()
    document.body.append(viewport)
    const messages: ChatboxMessage[] = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, role: 'assistant', content: 'Synthetic', ts: i }))
    const project = (message: ChatboxMessage, index: number): FloorView => ({
      message, index, html: 'Synthetic', thinking: [], thinkingOpen: false, thinkingLive: false, panels: { top: [], bottom: [] },
      capsule: { flat: [], templateLines: [], total: 0 }, capsuleOpen: false, isHtmlFrame: false, wide: false, isStreaming: false, isLastAssistant: false,
    })
    const wrapper = mount(ChatFloorList, { attachTo: viewport, props: {
      messages, scrollElement: viewport, followingOutput: false, project, editingFloorId: '', editDraft: '', streaming: false, ttsActive: false,
    } })
    await flushPromises()
    const instance = harness.instances[0]!
    const nodes = [...instance.elementsCache.values()]
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every(node => node.isConnected)).toBe(true)
    await wrapper.setProps({ messages: [] })
    await flushPromises()
    expect(nodes.every(node => !node.isConnected)).toBe(true)
    expect([...instance.elementsCache.values()]).toEqual([])
    await wrapper.setProps({ messages })
    await flushPromises()
    expect(instance.elementsCache.size).toBeGreaterThan(0)
    wrapper.unmount()
    await flushPromises()
    expect(instance.elementsCache.size).toBe(0)
  })
})
