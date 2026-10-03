import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  registerSettingsSection,
  usePluginConfigSections,
  useSettingsProjection,
} from '@/kernel/app/settings-registry'

/** M3-w followups regression net (registry level): 变量分析/提示词预设 are
 *  host-registered (App.vue) with placement 'plugin' under the plugins' ids
 *  — they must land in the plugin-config projection (the tools-area
 *  accordion renders from it) and stay OUT of the settings-page projection.
 *  The DOM side is covered by emulator acceptance; jsdom tooling here pins
 *  the registry wiring only. */
describe('M3-w followups · 宿主注册的插件条目配置分区（registry 层）', () => {
  it('placement plugin 分区落位插件 id，且不进设置页投影', async () => {
    const disposeVars = registerSettingsSection('variables', {
      id: 'variables-analysis',
      title: '变量分析',
      component: (() => null) as unknown as never,
      placement: 'plugin',
    }, 10)
    const disposePresets = registerSettingsSection('presets', {
      id: 'presets',
      title: '预设设置',
      component: (() => null) as unknown as never,
      placement: 'plugin',
    }, 10)

    await nextTick()
    const configSections = usePluginConfigSections()
    const varsPanels = configSections.value.get('variables') ?? []
    const presetsPanels = configSections.value.get('presets') ?? []
    // Registry ids are source-qualified: `source:spec.id`.
    expect(varsPanels.map((s) => s.id)).toEqual(['variables:variables-analysis'])
    expect(presetsPanels.map((s) => s.id)).toEqual(['presets:presets'])

    const settingsProjection = useSettingsProjection()
    const settingsTitles = settingsProjection.value
      .filter((s) => s.placement === 'settings')
      .map((s) => s.title)
    expect(settingsTitles).not.toContain('变量分析')
    expect(settingsTitles).not.toContain('提示词预设')

    disposeVars()
    disposePresets()
  })
})
