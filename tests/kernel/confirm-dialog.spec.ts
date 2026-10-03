import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ConfirmDialogHost from '@/kernel/ui/ConfirmDialogHost.vue'
import { resolveConfirm, useConfirmDialog } from '@/kernel/ui/confirm-dialog'
import { uiService } from '@/kernel/ui/toasts'

// Module-singleton queue: drain any leftovers so tests stay independent.
afterEach(() => {
  for (const request of [...useConfirmDialog().value]) {
    resolveConfirm(request.id, false)
  }
})

describe('M4-a · 应用内确认模态(confirm 升级)', () => {
  it('确认按钮解析 true,模态随后关闭', async () => {
    const wrapper = mount(ConfirmDialogHost)
    const pending = uiService.confirm('shell', { title: '删除角色卡', message: '卡与会话一并删除' })
    await flushPromises()

    expect(wrapper.text()).toContain('删除角色卡')
    expect(wrapper.text()).toContain('卡与会话一并删除')
    // 默认按钮文案。
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['取消', '确定'])

    await buttons[1]!.trigger('click')
    await expect(pending).resolves.toBe(true)
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('取消按钮解析 false', async () => {
    const wrapper = mount(ConfirmDialogHost)
    const pending = uiService.confirm('shell', { title: '清空重开' })
    await flushPromises()

    await wrapper.findAll('button')[0]!.trigger('click')
    await expect(pending).resolves.toBe(false)
  })

  it('confirmLabel 可定制(删除等破坏性动作)', async () => {
    const wrapper = mount(ConfirmDialogHost)
    const pending = uiService.confirm('shell', { title: '删除变量', confirmLabel: '删除' })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['取消', '删除'])
    await buttons[1]!.trigger('click')
    await expect(pending).resolves.toBe(true)
  })

  it('并发请求排队:先到先答,后到的随后出现', async () => {
    const wrapper = mount(ConfirmDialogHost)
    const first = uiService.confirm('shell', { title: '第一个' })
    const second = uiService.confirm('shell', { title: '第二个' })
    await flushPromises()

    // 只渲染队首。
    expect(wrapper.text()).toContain('第一个')
    expect(wrapper.text()).not.toContain('第二个')

    await wrapper.findAll('button')[1]!.trigger('click')
    await expect(first).resolves.toBe(true)
    await flushPromises()
    expect(wrapper.text()).toContain('第二个')

    await wrapper.findAll('button')[0]!.trigger('click')
    await expect(second).resolves.toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
