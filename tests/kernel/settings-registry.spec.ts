import { describe, expect, it } from 'vitest'
import {
  getRegisteredSettingsSections,
  registerSettingsSection,
  settingsSink,
  usePluginConfigSections,
  useSettingsProjection,
} from '@/kernel/app/settings-registry'

const FakeComponent = () => null

describe('kernel/app/settings-registry (M2)', () => {
  it('projection sorts by order ascending, stable on ties', () => {
    const disposers = [
      registerSettingsSection('kernel', { id: 'late', title: '后注册高序', component: FakeComponent, placement: 'settings' }, 20),
      registerSettingsSection('kernel', { id: 'early', title: '低序', component: FakeComponent, placement: 'settings' }, 10),
      registerSettingsSection('kernel', { id: 'tie-a', title: '同序甲', component: FakeComponent, placement: 'settings' }, 15),
      registerSettingsSection('kernel', { id: 'tie-b', title: '同序乙', component: FakeComponent, placement: 'settings' }, 15),
    ]

    expect(useSettingsProjection().value.map((section) => section.id)).toEqual([
      'kernel:early',
      'kernel:tie-a',
      'kernel:tie-b',
      'kernel:late',
    ])

    disposers.forEach((dispose) => dispose())
    expect(getRegisteredSettingsSections()).toHaveLength(0)
  })

  it('duplicate ids are a programming error; unregister is idempotent', () => {
    const dispose = registerSettingsSection('kernel', { id: 'dup', title: '重复', component: FakeComponent, placement: 'settings' })
    expect(() =>
      registerSettingsSection('kernel', { id: 'dup', title: '重复二', component: FakeComponent, placement: 'settings' }),
    ).toThrow(/\[settings-registry\] duplicate section id: kernel:dup/)

    dispose()
    dispose()
    expect(getRegisteredSettingsSections()).toHaveLength(0)
  })

  it('the runtime settings sink namespaces plugin sections under the plugin id', () => {
    const dispose = settingsSink.registerSection('some-plugin', {
      id: 'main',
      title: '插件分区',
      component: FakeComponent,
    })
    expect(getRegisteredSettingsSections().map((section) => section.id)).toContain('some-plugin:main')

    dispose()
    expect(getRegisteredSettingsSections().some((section) => section.id === 'some-plugin:main')).toBe(false)
  })

  it('placement partitions panels: default = plugin entry, declared = settings (M3-h)', () => {
    const disposers = [
      // Omitted placement defaults to the plugin's own entry (shape rule).
      settingsSink.registerSection('tts', { id: 'tts', title: '语音设置', component: FakeComponent }),
      // Panels whose function belongs on the settings page declare it.
      settingsSink.registerSection('update-checker', { id: 'update-checker', title: '关于与更新', component: FakeComponent, placement: 'settings' }),
      // Kernel page sections declare 'settings' explicitly as well.
      registerSettingsSection('kernel', { id: 'persona', title: '用户设定', component: FakeComponent, placement: 'settings' }, 10),
    ]

    expect(useSettingsProjection().value.map((section) => section.id)).toEqual([
      'kernel:persona',
      'update-checker:update-checker',
    ])

    const grouped = usePluginConfigSections().value
    expect([...grouped.keys()]).toEqual(['tts'])
    expect(grouped.get('tts')?.map((section) => section.title)).toEqual(['语音设置'])

    disposers.forEach((dispose) => dispose())
    expect(getRegisteredSettingsSections()).toHaveLength(0)
    expect(usePluginConfigSections().value.size).toBe(0)
  })
})
