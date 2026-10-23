import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ToastHost from '@/kernel/ui/ToastHost.vue'
import { useToasts } from '@/kernel/ui/toasts'
import ChatFloor from '@/kernel/app/chat/ChatFloor.vue'
import type { FloorView } from '@/kernel/app/chat/floor-view'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); useToasts().value = []; vi.restoreAllMocks() })

describe('motion review UI', () => {
  it('keeps the leaving toast at its measured position and width', async () => {
    useToasts().value = [{ id: 1, owner: 'shell', message: 'Synthetic toast', tone: 'info', sticky: false }]
    wrapper = mount(ToastHost, { global: { stubs: { 'transition-group': false } } })
    const toast = wrapper.get('.pointer-events-auto').element as HTMLElement
    vi.spyOn(toast, 'getBoundingClientRect').mockReturnValue(new DOMRect(28, 420, 304, 64))
    useToasts().value = []
    await nextTick()
    expect(toast.style.left).toBe('28px')
    expect(toast.style.top).toBe('420px')
    expect(toast.style.width).toBe('304px')
  })

  it('does not reserve capsule spacing while its disclosure is closed', async () => {
    const project = (): FloorView => ({
      message: { id: 'fixture', role: 'assistant', content: 'Synthetic', ts: 0 }, index: 0,
      html: 'Synthetic', thinking: [], thinkingOpen: false, thinkingLive: false,
      panels: { top: [], bottom: [] }, capsule: { flat: [], templateLines: [], total: 0 },
      capsuleOpen: false, isHtmlFrame: false, wide: false, isStreaming: false, isLastAssistant: true,
    })
    wrapper = mount(ChatFloor, { props: {
      message: project().message, index: 0, project, editingFloorId: '', editDraft: '', streaming: false, ttsActive: false,
    } })
    expect(wrapper.get('.mp-mo-collapse').classes()).not.toContain('mt-1')
    await wrapper.setProps({ project: () => ({ ...project(), capsuleOpen: true }) })
    expect(wrapper.get('.mp-mo-collapse').classes()).toContain('mt-1')
  })
})
