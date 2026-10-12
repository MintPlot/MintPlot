// 用户设定 person chips (1.0.x → 风格维度 v3): the person chips ARE the
// preset-store's person-dimension entries (all three seeds) — mutual
// exclusion, tap-to-clear, and the presets panel sees the same state (single
// source of truth).
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UserPersonaSection from '@/kernel/app/sections/UserPersonaSection.vue'
import { SETTINGS_STATE_KEY, PRESET_STORE_KEY } from '@/kernel/app/chat-keys'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const mountSection = async () => {
  const settingsState = createSettingsState(createStorageRepository(createMemoryEngine()))
  const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
  const wrapper = mount(UserPersonaSection, {
    global: { provide: { [SETTINGS_STATE_KEY as symbol]: settingsState, [PRESET_STORE_KEY as symbol]: presetStore } },
  })
  await flushPromises()
  return { wrapper, presetStore }
}

const chipOf = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)!

const personChips = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').filter((button) => (button.attributes('aria-label') ?? '').startsWith('选择人称'))

describe('UserPersonaSection · 人称联动', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('种子态上屏:三颗 chips 自然序,仅第三人称亮', async () => {
    const { wrapper } = await mountSection()
    expect(personChips(wrapper).map((chip) => chip.text())).toEqual(['第一人称', '第二人称', '第三人称'])
    expect(chipOf(wrapper, '第三人称').attributes('aria-pressed')).toBe('true')
    expect(chipOf(wrapper, '第二人称').attributes('aria-pressed')).toBe('false')
    expect(chipOf(wrapper, '第一人称').attributes('aria-pressed')).toBe('false')
  })

  it('选第二人称:互斥关掉第三人称,预设仓同源可见', async () => {
    const { wrapper, presetStore } = await mountSection()
    await chipOf(wrapper, '第二人称').trigger('click')
    await flushPromises()

    const snapshot = await presetStore.get()
    const byName = (name: string) => snapshot.entries.find((entry) => entry.name === name)!
    expect(byName('第二人称').enabled).toBe(true)
    expect(byName('第三人称').enabled).toBe(false)
    // The chips mirror the store (one source of truth).
    expect(chipOf(wrapper, '第二人称').attributes('aria-pressed')).toBe('true')
    expect(chipOf(wrapper, '第三人称').attributes('aria-pressed')).toBe('false')
  })

  it('再点已亮的:取消(双双关闭)', async () => {
    const { wrapper, presetStore } = await mountSection()
    await chipOf(wrapper, '第三人称').trigger('click')
    await flushPromises()
    const snapshot = await presetStore.get()
    expect(snapshot.entries.find((entry) => entry.name === '第三人称')!.enabled).toBe(false)
    expect(snapshot.entries.find((entry) => entry.name === '第二人称')!.enabled).toBe(false)
  })

  it('自建 person 条目出 chip,点亮即互斥关掉种子', async () => {
    // Shared store across mounts — the section reads on mount only.
    const settingsState = createSettingsState(createStorageRepository(createMemoryEngine()))
    const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
    const mountWith = async () => {
      const wrapper = mount(UserPersonaSection, {
        global: { provide: { [SETTINGS_STATE_KEY as symbol]: settingsState, [PRESET_STORE_KEY as symbol]: presetStore } },
      })
      await flushPromises()
      return wrapper
    }
    await presetStore.addEntry({ name: '第一人称·群像', content: 'x', role: 'system', dimension: 'person' })
    const first = await mountWith()
    // addEntry lands enabled and runs the single-select mutex: the custom
    // chip is lit immediately, the seeded 第三人称 got dimmed.
    expect(personChips(first).map((chip) => chip.text())).toEqual(['第一人称', '第二人称', '第三人称', '第一人称·群像'])
    expect(personChips(first).at(-1)!.attributes('aria-pressed')).toBe('true')
    expect(chipOf(first, '第三人称').attributes('aria-pressed')).toBe('false')

    await personChips(first).at(-1)!.trigger('click')
    await flushPromises()
    expect(personChips(first).at(-1)!.attributes('aria-pressed')).toBe('false')
  })

  it('person 条目全部删掉:人称行整体隐藏', async () => {
    // Same stores across both mounts — the remount must see the deletions.
    const settingsState = createSettingsState(createStorageRepository(createMemoryEngine()))
    const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
    const mountWith = async () => {
      const wrapper = mount(UserPersonaSection, {
        global: { provide: { [SETTINGS_STATE_KEY as symbol]: settingsState, [PRESET_STORE_KEY as symbol]: presetStore } },
      })
      await flushPromises()
      return wrapper
    }
    const wrapper = await mountWith()
    const snapshot = await presetStore.get()
    for (const entry of snapshot.entries.filter((item) => item.dimension === 'person')) {
      await presetStore.removeEntry(entry.id)
    }
    wrapper.unmount()
    const remounted = await mountWith()
    expect(personChips(remounted)).toHaveLength(0)
    expect(remounted.text()).not.toContain('与「提示词预设」')
  })
})
