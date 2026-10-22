import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import type { PluginStateProjection } from '@/kernel/runtime/runtime'
import PluginArea from '@/kernel/app/sections/PluginArea.vue'
import { PLUGIN_BUS_KEY, PLUGIN_RUNTIME_KEY, PLUGIN_SETTINGS_STORE_KEY } from '@/kernel/app/runtime-key'
import { TOOLS_UI_KEY, createToolsUi } from '@/kernel/app/tools-ui-state'
import { createKvStore, createMemoryEngine } from '@/kernel/store/kv-store'
import { registerSettingsSection } from '@/kernel/app/settings-registry'

const FakeComponent = () => null

function makePlugin(id: string, category: 'system' | 'extension', state: 'registered' | 'active'): PluginStateProjection {
  return {
    id,
    version: '1.0.0',
    activation: 'lazy',
    display: { name: `名·${id}`, description: `${id} 的一句话简介` },
    category,
    state,
    permissions: ['settings.section'],
    sessions: undefined,
  }
}

/** Fake runtime over a mutable list; mirrors the real broadcast contract. */
function makeRuntime(bus: ReturnType<typeof createTransientBus>, plugins: PluginStateProjection[]) {
  const mutable = plugins as Array<{ -readonly [K in keyof PluginStateProjection]: PluginStateProjection[K] }>
  return {
    load: () => undefined,
    activate: async (id: string) => {
      const plugin = mutable.find((entry) => entry.id === id)
      if (plugin) plugin.state = 'active'
      bus.emit('plugin.state.changed', { pluginId: id, state: 'active' })
    },
    deactivate: async (id: string) => {
      const plugin = mutable.find((entry) => entry.id === id)
      if (plugin) plugin.state = 'registered'
      bus.emit('plugin.state.changed', { pluginId: id, state: 'registered' })
    },
    // Fresh array per call, like the real runtime.projection() — a stable
    // reference would cut the computed invalidation chain the UI relies on.
    projection: () => [...plugins],
  }
}

function mountArea(plugins: PluginStateProjection[]) {
  const bus = createTransientBus()
  const store = createKvStore(createMemoryEngine())
  const wrapper = mount(PluginArea, {
    global: {
      provide: {
        [PLUGIN_RUNTIME_KEY as symbol]: makeRuntime(bus, plugins),
        [PLUGIN_BUS_KEY as symbol]: bus,
        [PLUGIN_SETTINGS_STORE_KEY as symbol]: store,
        [TOOLS_UI_KEY as symbol]: createToolsUi(store),
      },
    },
  })
  return { wrapper, store }
}

const openSystemGroup = async (wrapper: ReturnType<typeof mountArea>['wrapper']): Promise<void> => {
  await wrapper.findAll('button').find((button) => button.text().includes('系统插件'))!.trigger('click')
}

describe('kernel/app · PluginArea (M3-h)', () => {
  it('groups plugins by effective category; rows show the display card + switch only', async () => {
    const { wrapper } = mountArea([
      makePlugin('tts', 'system', 'active'),
      makePlugin('usage-stats', 'system', 'registered'),
      makePlugin('future-ext', 'extension', 'registered'),
    ])

    // Groups start collapsed.
    expect(wrapper.text()).not.toContain('名·tts')
    await openSystemGroup(wrapper)

    expect(wrapper.text()).toContain('名·tts')
    expect(wrapper.text()).toContain('tts 的一句话简介')
    expect(wrapper.text()).toContain('名·usage-stats')
    expect(wrapper.text()).not.toContain('名·future-ext')
    // Empty-state hint is a true empty state (bugfix semantics): with an
    // extension plugin present the group is NOT empty — the old v-else-if
    // kept the hint in the DOM beside a real plugin.
    expect(wrapper.text()).not.toContain('外部插件(M4+)安装后出现在这里')

    // Rows never show raw ids (id lives in the expanded meta line).
    expect(wrapper.text()).not.toContain('usage-stats v1.0.0')
  })

  it('empty extension group shows the install hint when opened (bugfix pin)', async () => {
    const { wrapper } = mountArea([makePlugin('tts', 'system', 'active')])
    await wrapper.findAll('button').find((button) => button.text().includes('扩展插件'))!.trigger('click')
    expect(wrapper.text()).toContain('外部插件(M4+)安装后出现在这里')
  })

  it('config expand affordance exists only for plugins with plugin-placement sections', async () => {
    const dispose = registerSettingsSection('tts', { id: 'tts', title: '语音设置', component: FakeComponent, placement: 'plugin' })
    try {
      const { wrapper } = mountArea([makePlugin('tts', 'system', 'registered'), makePlugin('usage-stats', 'system', 'registered')])
      await openSystemGroup(wrapper)

      // usage-stats has no config → no arrow; tts has one.
      expect(wrapper.findAll('[aria-label="展开配置"]')).toHaveLength(1)

      // Expanding a deactivated plugin shows the hint, not the config.
      await wrapper.get('[aria-label="展开配置"]').trigger('click')
      expect(wrapper.text()).toContain('插件已停用,启用后可配置')
      expect(wrapper.text()).not.toContain('语音设置')
    } finally {
      dispose()
    }
  })

  it('the switch drives activate/deactivate; expanding an active plugin renders its config', async () => {
    const dispose = registerSettingsSection('tts', { id: 'tts', title: '语音设置', component: FakeComponent, placement: 'plugin' })
    try {
      const { wrapper } = mountArea([makePlugin('tts', 'system', 'registered')])
      await openSystemGroup(wrapper)

      // Toggle on → expand: config renders with the meta line.
      await wrapper.get('li input[type="checkbox"]').setValue(true)
      await wrapper.get('[aria-label="展开配置"]').trigger('click')
      expect(wrapper.text()).toContain('语音设置')
      expect(wrapper.text()).toContain('tts · v1.0.0 · 1 项权限')
      expect(wrapper.text()).not.toContain('插件已停用')

      // Toggle off → the expanded area degrades to the hint.
      await wrapper.get('li input[type="checkbox"]').setValue(false)
      expect(wrapper.text()).not.toContain('语音设置')
      expect(wrapper.text()).toContain('插件已停用,启用后可配置')
    } finally {
      dispose()
    }
  })

  it('group fold state persists through the tools-ui store', async () => {
    const { wrapper, store } = mountArea([makePlugin('tts', 'system', 'registered')])
    await openSystemGroup(wrapper)
    const saved = await store.get<{ groups: Record<string, boolean> }>('tools-ui-state')
    expect(saved?.groups.system).toBe(true)
    wrapper.unmount()
  })

  it('a degraded plugin shows the 异常 badge; healthy rows do not (M3-err3)', async () => {
    const degraded: PluginStateProjection = { ...makePlugin('broken', 'system', 'registered'), state: 'degraded' }
    const { wrapper } = mountArea([makePlugin('tts', 'system', 'active'), degraded])
    await openSystemGroup(wrapper)

    expect(wrapper.text()).toContain('异常')
    // Exactly one badge — the healthy plugin row stays clean.
    expect(wrapper.findAll('span').filter((span) => span.text() === '异常')).toHaveLength(1)
  })
})
