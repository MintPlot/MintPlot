// 用户设定 person chips (1.0.x): the 第二/第三人称 toggles in the persona
// section ARE the preset-store entries — mutual exclusion, tap-to-clear, and
// the presets panel sees the same state (single source of truth).
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

describe('UserPersonaSection · 人称联动', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('种子态上屏:第三人称亮、第二人称不亮(默认仅第三人称)', async () => {
    const { wrapper } = await mountSection()
    expect(chipOf(wrapper, '第三人称').attributes('aria-pressed')).toBe('true')
    expect(chipOf(wrapper, '第二人称').attributes('aria-pressed')).toBe('false')
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

  it('两预设条目都被删掉:人称行整体隐藏', async () => {
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
    for (const entry of snapshot.entries.filter((item) => item.name === '第二人称' || item.name === '第三人称')) {
      await presetStore.removeEntry(entry.id)
    }
    wrapper.unmount()
    const remounted = await mountWith()
    expect(remounted.text()).not.toContain('人称')
  })
})
