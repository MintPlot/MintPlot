// Settings-page accordion (1.0.x): every card collapses, 用户设定 alone is
// expanded by default, and the expanded set persists in localStorage
// (mp_settings_expanded). Persistence stores the FULL current expanded set,
// so the default-expanded persona rides onto storage on the first toggle and
// untouched defaults never collapse as a side effect of another toggle.
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SettingsView from '@/kernel/app/views/SettingsView.vue'
import { registerSettingsSection } from '@/kernel/app/settings-registry'

const PersonaStub = { template: '<p>persona-body</p>' }
const ApiStub = { template: '<p>api-body</p>' }

const bodyOf = (wrapper: ReturnType<typeof mount>, id: string) =>
  (wrapper.element as HTMLElement).querySelector(`[id="${id}-body"]`) as HTMLElement

/** Motion batch (2026-10-17): the body moved from v-show to the grid-rows
 * collapse — jsdom runs no CSS, so open/closed is asserted through the
 * collapse-open class instead of computed display. */
const isOpen = (wrapper: ReturnType<typeof mount>, id: string): boolean =>
  bodyOf(wrapper, id).classList.contains('mp-mo-collapse-open')

describe('SettingsView · 折叠手风琴', () => {
  let disposers: Array<() => void>

  const mountView = async () => {
    const wrapper = mount(SettingsView)
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    localStorage.removeItem('mp_settings_expanded')
    disposers = [
      registerSettingsSection('kernel', { id: 'persona', title: '用户设定', component: PersonaStub, placement: 'settings' }, 10),
      registerSettingsSection('kernel', { id: 'api', title: 'API 连接与服务', component: ApiStub, placement: 'settings' }, 20),
    ]
  })

  // Mounted components hold the projection computed; disposing after unmount
  // keeps the singleton registry clean for the next test.
  const disposeAll = (): void => disposers.forEach((dispose) => dispose())

  it('默认:用户设定展开,其余收起', async () => {
    const wrapper = await mountView()
    const headers = wrapper.findAll('button[aria-expanded]')
    expect(headers).toHaveLength(2)
    expect(headers[0]!.attributes('aria-expanded')).toBe('true')
    expect(headers[1]!.attributes('aria-expanded')).toBe('false')
    expect(isOpen(wrapper, 'kernel:persona')).toBe(true)
    expect(isOpen(wrapper, 'kernel:api')).toBe(false)
    disposeAll()
  })

  it('点表头开合,展开集完整落盘(默认展开项随首次触碰一起写入)', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('button[aria-expanded]')[1]!.trigger('click')
    expect(wrapper.findAll('button[aria-expanded]')[1]!.attributes('aria-expanded')).toBe('true')
    expect(JSON.parse(localStorage.getItem('mp_settings_expanded')!)).toEqual(['kernel:persona', 'kernel:api'])

    // Collapse persona: only api stays in storage.
    await wrapper.findAll('button[aria-expanded]')[0]!.trigger('click')
    expect(JSON.parse(localStorage.getItem('mp_settings_expanded')!)).toEqual(['kernel:api'])
    disposeAll()
  })

  it('重启(重挂载)记住用户选择', async () => {
    localStorage.setItem('mp_settings_expanded', JSON.stringify(['kernel:api']))
    const wrapper = await mountView()
    expect(wrapper.findAll('button[aria-expanded]')[0]!.attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('button[aria-expanded]')[1]!.attributes('aria-expanded')).toBe('true')
    expect(isOpen(wrapper, 'kernel:api')).toBe(true)
    disposeAll()
  })

  it('坏存储回落默认(persona 展开)', async () => {
    localStorage.setItem('mp_settings_expanded', '{not json')
    const wrapper = await mountView()
    expect(wrapper.findAll('button[aria-expanded]')[0]!.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('button[aria-expanded]')[1]!.attributes('aria-expanded')).toBe('false')
    disposeAll()
  })
})
