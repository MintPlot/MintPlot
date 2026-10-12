// PresetSection editor dimension support (S4): the dimension dropdown tags
// entries for the style system — picking one locks the role to 系统 (S2
// semantics: tagged entries ride the dimension block, system channel), the
// entry row shows a dimension badge, and save persists through the store.
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PresetSection from '@/kernel/app/sections/PresetSection.vue'
import { PRESET_STORE_KEY } from '@/kernel/app/chat-keys'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const mountSection = async () => {
  const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
  const wrapper = mount(PresetSection, {
    global: { provide: { [PRESET_STORE_KEY as symbol]: presetStore } },
  })
  await flushPromises()
  return { wrapper, presetStore }
}

describe('PresetSection · 维度编辑 (S4)', () => {
  it('新建带维度条目:选维度锁系统角色,保存后 store 与条目行同源可见', async () => {
    const { wrapper, presetStore } = await mountSection()
    await wrapper.findAll('button').find((button) => button.text() === '新建条目')!.trigger('click')

    const nameInput = wrapper.find('input[placeholder="条目名称"]')
    await nameInput.setValue('我的氛围')
    const selects = wrapper.findAll('select')
    // Editor selects: [维度, 角色] (group switcher sits in the header row).
    const dimensionSelect = selects.at(-2)!
    const roleSelect = selects.at(-1)!
    await dimensionSelect.setValue('mood')
    // Role select locked to 系统 while a dimension is set.
    expect((roleSelect.element as HTMLSelectElement).disabled).toBe(true)

    await wrapper.find('textarea').setValue('自定义氛围文案')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    await flushPromises()

    const saved = (await presetStore.get()).entries.find((entry) => entry.name === '我的氛围')
    expect(saved).toMatchObject({ dimension: 'mood', role: 'system' })
    const row = wrapper.findAll('li').find((li) => li.text().includes('我的氛围'))!
    expect(row.text()).toContain('氛围')
  })

  it('编辑存量维度条目:下拉回显维度,清除维度(无)后保存回落普通条目', async () => {
    const { wrapper, presetStore } = await mountSection()
    const personRow = wrapper.findAll('li').find((li) => li.text().includes('第三人称'))!
    await personRow.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')

    const dimensionSelect = wrapper.findAll('select').at(-2)!
    expect((dimensionSelect.element as HTMLSelectElement).value).toBe('person')

    await dimensionSelect.setValue('')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    await flushPromises()

    const saved = (await presetStore.get()).entries.find((entry) => entry.name === '第三人称')
    expect(saved?.dimension).toBeUndefined()
  })
})
