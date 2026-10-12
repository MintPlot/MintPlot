// 用户设定 avatar (1.0.x): 64px picker beside the nickname input, persisted
// as a compressed data URL under mp_settings.userAvatar; the badge clears it
// back to the brand-cat placeholder.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UserPersonaSection from '@/kernel/app/sections/UserPersonaSection.vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const AVATAR = 'data:image/jpeg;base64,avatar-bytes'

describe('UserPersonaSection · 用户头像', () => {
  const makeSection = () => {
    const settingsState = createSettingsState(createStorageRepository(createMemoryEngine()))
    const mountSection = async () => {
      const wrapper = mount(UserPersonaSection, {
        global: { provide: { [SETTINGS_STATE_KEY as symbol]: settingsState } },
      })
      await flushPromises()
      return wrapper
    }
    return { settingsState, mountSection }
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('无头像:占位猫 + 无移除角标;昵称与人设照常回显', async () => {
    const { settingsState, mountSection } = makeSection()
    Object.assign(settingsState.scope(['userName', 'userPersona']), { userName: '旅人', userPersona: '沉默的观察者' })
    const wrapper = await mountSection()
    expect(wrapper.find('img[alt="用户头像"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="移除头像"]').exists()).toBe(false)
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('旅人')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('沉默的观察者')
  })

  it('选择图片:走压缩管线(长边 256)落库 userAvatar 并上屏', async () => {
    const { settingsState, mountSection } = makeSection()
    const wrapper = await mountSection()
    const vision = await import('@/kernel/llm/vision')
    // jsdom has no canvas/createImageBitmap — stub at the module seam so the
    // picker path stays deterministic.
    const spy = vi.spyOn(vision, 'compressImageFile').mockResolvedValue('data:image/jpeg;base64,shrunken')
    const file = new File(['bytes'], 'me.png', { type: 'image/png' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith(file, 256)
    expect(settingsState.scope(['userAvatar']).userAvatar).toBe('data:image/jpeg;base64,shrunken')
    expect(wrapper.find('img[alt="用户头像"]').attributes('src')).toBe('data:image/jpeg;base64,shrunken')
    // The input resets after the read (M4-d WebView File-handle gotcha).
    expect((input.element as HTMLInputElement).value).toBe('')
    spy.mockRestore()
  })

  it('移除角标:清空 userAvatar 回落占位', async () => {
    const { settingsState, mountSection } = makeSection()
    settingsState.scope(['userAvatar']).userAvatar = AVATAR
    const wrapper = await mountSection()
    expect(wrapper.find('img[alt="用户头像"]').exists()).toBe(true)
    await wrapper.find('button[aria-label="移除头像"]').trigger('click')
    expect(settingsState.scope(['userAvatar']).userAvatar).toBe('')
    expect(wrapper.find('img[alt="用户头像"]').exists()).toBe(false)
  })
})
