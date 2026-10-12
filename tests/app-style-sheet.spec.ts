// 风格面板 (S3, planning style-dimension-presets-plan D7): follow-global
// lockout, single-select/multi-select chip semantics, live disclosure with
// source badges, and the saved selection shape riding the save event.
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StyleSheet from '@/kernel/app/sections/StyleSheet.vue'
import type { PresetSnapshot } from '@/kernel/presets/preset-store'
import type { CardStyleSelection } from '@/kernel/presets/style-assembly'

const snapshot = (): PresetSnapshot => ({
  groups: [{ id: 'default', name: '默认预设', builtin: true, enabled: true }],
  entries: [
    { id: 'p3', name: '第三人称', content: '第三人称文案', enabled: true, role: 'system', group: 'default', dimension: 'person' },
    { id: 'p2', name: '第二人称', content: '第二人称文案', enabled: false, role: 'system', group: 'default', dimension: 'person' },
    { id: 'len1', name: '细腻篇幅', content: '细腻文案', enabled: true, role: 'system', group: 'default', dimension: 'length' },
    { id: 'mood1', name: '温馨治愈', content: '治愈文案', enabled: false, role: 'system', group: 'default', dimension: 'mood' },
    { id: 'mood2', name: '紧张悬疑', content: '悬疑文案', enabled: false, role: 'system', group: 'default', dimension: 'mood' },
    { id: 'plain', name: '时间戳', content: '时间戳文案', enabled: true, role: 'system', group: 'default' },
  ],
})

const mountSheet = (selection: CardStyleSelection | null = null) =>
  mount(StyleSheet, { props: { selection, snapshot: snapshot() } })

const buttonByLabel = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((button) => button.attributes('aria-label')?.includes(label))!

describe('StyleSheet · 卡域风格面板', () => {
  it('默认跟随全局:维度区隐藏,披露显示全局激活条目并标注来源', () => {
    const wrapper = mountSheet()
    expect(wrapper.text()).toContain('当前全局')
    expect(wrapper.text()).toContain('第三人称')
    expect(wrapper.text()).toContain('细腻篇幅')
    expect(wrapper.text()).toContain('全局')
    // Dimension chip area is locked away while following global.
    expect(wrapper.find('button[aria-label*="第二人称"]').exists()).toBe(false)
  })

  it('关闭跟随:chips 上屏,单选维度点选互斥、再点取消;多选维度自由叠加', async () => {
    const wrapper = mountSheet({ followGlobal: false, picks: {} })
    const person2 = buttonByLabel(wrapper, '第二人称')
    const person3 = buttonByLabel(wrapper, '第三人称')
    await person2.trigger('click')
    expect(person2.classes().join(' ')).toContain('text-primary')
    await person3.trigger('click')
    // Single-select: the sibling pick was replaced.
    expect(buttonByLabel(wrapper, '第二人称').classes().join(' ')).not.toContain('text-primary')
    expect(person3.classes().join(' ')).toContain('text-primary')
    await person3.trigger('click')
    // Re-click clears the dimension entirely (不约束).
    expect(person3.classes().join(' ')).not.toContain('text-primary')

    const mood1 = buttonByLabel(wrapper, '温馨治愈')
    const mood2 = buttonByLabel(wrapper, '紧张悬疑')
    await mood1.trigger('click')
    await mood2.trigger('click')
    expect(mood1.classes().join(' ')).toContain('text-primary')
    expect(mood2.classes().join(' ')).toContain('text-primary')
  })

  it('披露实时预览未保存的调整,save 事件携带完整选择形状', async () => {
    const wrapper = mountSheet({ followGlobal: false, picks: {} })
    await buttonByLabel(wrapper, '第二人称').trigger('click')
    await buttonByLabel(wrapper, '温馨治愈').trigger('click')
    // Disclosure previews the DRAFT (源 = 本卡 badge).
    expect(wrapper.text()).toContain('本卡')
    expect(wrapper.text()).toContain('第二人称文案')

    await wrapper.findAll('button').find((button) => button.text() === '保存本卡风格')!.trigger('click')
    const emitted = wrapper.emitted('save')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]![0]).toEqual({
      followGlobal: false,
      picks: { person: ['p2'], mood: ['mood1'] },
    })
  })

  it('恢复跟随一键回全局并立即保存', async () => {
    const wrapper = mountSheet({ followGlobal: false, picks: { person: ['p2'] } })
    await wrapper.findAll('button').find((button) => button.text() === '恢复跟随')!.trigger('click')
    const emitted = wrapper.emitted('save')
    expect(emitted![0]![0]).toEqual({ followGlobal: true, picks: { person: ['p2'] } })
    expect(wrapper.text()).toContain('当前全局')
  })

  it('空库维度显示占位,披露空态如实', () => {
    const wrapper = mount(StyleSheet, {
      props: {
        selection: null,
        snapshot: { groups: [], entries: [] },
      },
    })
    expect(wrapper.text()).toContain('全局暂未启用任何风格条目')
  })
})
