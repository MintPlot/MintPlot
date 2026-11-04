/**
 * 对话输出 section (文本输出形式): the segmented control persists
 * `uiTextOutputMode` into the mp_settings blob — 'stream' default on first
 * mount, 'whole' after choosing 整段输出, re-read on remount.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import OutputSection from '@/kernel/app/sections/OutputSection.vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import type { KvEngine } from '@/kernel/store/kv-store'

let rawEngine: KvEngine

const makeSettings = async (preset?: 'whole') => {
  rawEngine = createMemoryEngine()
  const settings = createSettingsState(createStorageRepository(rawEngine))
  if (preset) {
    const scope = settings.scope(['uiTextOutputMode'])
    scope.uiTextOutputMode = preset
    await settings.flush()
  }
  return settings
}

const mountSection = async (preset?: 'whole') => {
  const settings = await makeSettings(preset)
  const wrapper = mount(OutputSection, {
    global: { provide: { [SETTINGS_STATE_KEY as symbol]: settings } },
  })
  await flushPromises()
  return { wrapper: wrapper as ReturnType<typeof mount>, settings }
}

const checkedLabel = (wrapper: ReturnType<typeof mount>): string => {
  const checked = wrapper.findAll('button').find((button) => button.attributes('aria-checked') === 'true')
  return checked?.text() ?? ''
}

beforeEach(() => {
  localStorage.clear()
})

describe('kernel/app · 对话输出 (文本输出形式)', () => {
  it('defaults to 流式输出 on first mount (unset key reads as stream)', async () => {
    const { wrapper } = await mountSection()
    expect(checkedLabel(wrapper)).toBe('流式输出')
    expect(wrapper.text()).toContain('文本输出形式')
  })

  it('choosing 整段输出 persists uiTextOutputMode=whole into mp_settings', async () => {
    const { wrapper, settings } = await mountSection()
    await wrapper.findAll('button').find((button) => button.text() === '整段输出')!.trigger('click')
    await settings.flush()

    const raw = JSON.parse((await rawEngine.get('mp_settings')) ?? '{}') as Record<string, unknown>
    expect(raw.uiTextOutputMode).toBe('whole')
    expect(checkedLabel(wrapper)).toBe('整段输出')
  })

  it('switching back to 流式输出 persists stream', async () => {
    const { wrapper, settings } = await mountSection('whole')
    await wrapper.findAll('button').find((button) => button.text() === '流式输出')!.trigger('click')
    await settings.flush()

    const raw = JSON.parse((await rawEngine.get('mp_settings')) ?? '{}') as Record<string, unknown>
    expect(raw.uiTextOutputMode).toBe('stream')
  })

  it('a persisted whole mode is restored on mount (read-back)', async () => {
    const { wrapper } = await mountSection('whole')
    expect(checkedLabel(wrapper)).toBe('整段输出')
  })
})
