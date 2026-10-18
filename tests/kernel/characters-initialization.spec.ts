import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import CharactersView from '@/kernel/app/views/CharactersView.vue'
import { CHARACTER_STORE_KEY } from '@/kernel/app/chat-keys'

describe('character page initialization', () => {
  it('reads once on the first KeepAlive mount and refreshes on revisits without rereading missing covers', async () => {
    const visible = ref(true)
    const list = vi.fn(async () => [{ id: 'synthetic', name: 'Synthetic' }])
    const getCover = vi.fn(async () => null)
    const host = defineComponent({ setup: () => () => h(KeepAlive, null, {
      default: () => visible.value ? h(CharactersView) : h('div'),
    }) })
    const wrapper = mount(host, { global: { provide: { [CHARACTER_STORE_KEY as symbol]: { list, getCover } } } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    expect(getCover).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Synthetic')
    visible.value = false
    await flushPromises()
    visible.value = true
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    expect(getCover).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
})
