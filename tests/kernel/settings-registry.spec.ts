import { describe, expect, it } from 'vitest'
import {
  getRegisteredSettingsSections,
  registerSettingsSection,
  settingsSink,
  useSettingsProjection,
} from '@/kernel/app/settings-registry'

const FakeComponent = () => null

describe('kernel/app/settings-registry (M2)', () => {
  it('projection sorts by order ascending, stable on ties', () => {
    const disposers = [
      registerSettingsSection('kernel', { id: 'late', title: '后注册高序', component: FakeComponent }, 20),
      registerSettingsSection('kernel', { id: 'early', title: '低序', component: FakeComponent }, 10),
      registerSettingsSection('kernel', { id: 'tie-a', title: '同序甲', component: FakeComponent }, 15),
      registerSettingsSection('kernel', { id: 'tie-b', title: '同序乙', component: FakeComponent }, 15),
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
    const dispose = registerSettingsSection('kernel', { id: 'dup', title: '重复', component: FakeComponent })
    expect(() =>
      registerSettingsSection('kernel', { id: 'dup', title: '重复二', component: FakeComponent }),
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
})
