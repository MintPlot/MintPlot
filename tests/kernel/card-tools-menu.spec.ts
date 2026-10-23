import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CardToolsMenu from '@/kernel/app/chat/CardToolsMenu.vue'
import type { CardToolItem } from '@/kernel/app/chat/CardToolsMenu.vue'

const items: CardToolItem[] = [
  { id: 'variables', label: '变量', description: '状态与模板' },
  { id: 'worldbook', label: '世界书', description: '设定与触发条目' },
  { id: 'presets', label: '叙事预设', description: '本卡叙事搭配' },
]
const wrappers: ReturnType<typeof mount>[] = []
const mountMenu = (entries = items) => {
  const wrapper = mount(CardToolsMenu, { props: { items: entries }, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('card tools command menu', () => {
  it('starts collapsed and opens the provided commands with initial focus', async () => {
    const wrapper = mountMenu()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    const trigger = wrapper.get('button[aria-label="卡片工具"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3)
    expect(document.activeElement).toBe(wrapper.get('[role="menuitem"]').element)
  })

  it('selects a command and dismisses the menu before the parent opens a panel', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button[aria-label="卡片工具"]').trigger('click')
    await wrapper.get('button[aria-label="打开世界书"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['worldbook']])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('closes on outside click and on a repeated trigger click', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('button[aria-label="卡片工具"]')
    await trigger.trigger('click')
    await wrapper.get('[data-card-tools-dismiss]').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    await trigger.trigger('click')
    await trigger.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('closes on Escape and restores trigger focus', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('button[aria-label="卡片工具"]')
    await trigger.trigger('click')
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('supports wrapping arrow navigation and Home and End', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button[aria-label="卡片工具"]').trigger('click')
    const menu = wrapper.get('[role="menu"]')
    const commands = wrapper.findAll('[role="menuitem"]')
    await menu.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(commands[2]!.element)
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(commands[0]!.element)
    await menu.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(commands[2]!.element)
    await menu.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(commands[0]!.element)
  })

  it('does not show an empty trigger and closes when all capabilities disappear', async () => {
    const wrapper = mountMenu([])
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ items })
    await wrapper.get('button[aria-label="卡片工具"]').trigger('click')
    await wrapper.setProps({ items: [] })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
