import { describe, expect, it } from 'vitest'
import { validateManifest } from '@contracts'
import type { PluginManifest } from '@contracts'
import VariablesPlugin from '@/plugins/variables'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { KernelServices } from '@/kernel/runtime/context'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import { createKvStore, createMemoryEngine, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { uiService } from '@/kernel/ui/toasts'
import { pluginViewsSink } from '@/kernel/app/plugin-views'
import { settingsSink } from '@/kernel/app/settings-registry'
import { createMemorySettingsState } from '../helpers/memory-settings'

function makeServices(): KernelServices {
  const bus = createTransientBus()
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  return {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: { getCharacterName: () => '', getCharacterVoice: () => '', getMessageAt: () => null, setActiveCardSession: () => undefined },
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: { registerAction: () => () => {} },
    cardPanels: { registerSection: () => () => {} },
  }
}

describe('variables · manifest (M3-q2, R-03)', () => {
  it('validates: card-domain only, no permissions, display card present', () => {
    const result = validateManifest(VariablesPlugin.manifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const manifest = result.manifest as PluginManifest
    expect(manifest.id).toBe('variables')
    expect(manifest.activation).toBe('lazy')
    expect(manifest.sessions).toEqual(['card'])
    // The 变量分析 panel is host-registered (App.vue, placement 'plugin')
    // because the section component lives kernel-side — the plugin itself
    // needs no permissions.
    expect(manifest.permissions).toEqual([])
    expect(manifest.display).toEqual({
      name: '变量系统',
      description: expect.stringContaining('状态账本'),
    })
  })
})

describe('variables · runtime lifecycle (M3-q2)', () => {
  it('loads bundled (system category) and toggles registered ↔ active', async () => {
    const runtime = createPluginRuntime(makeServices())
    runtime.load(VariablesPlugin)

    const before = runtime.projection().find((entry) => entry.id === 'variables')
    expect(before).toMatchObject({ state: 'registered', category: 'system' })
    expect(runtime.stateOf('variables')).toBe('registered')

    await runtime.activate('variables')
    expect(runtime.stateOf('variables')).toBe('active')

    await runtime.deactivate('variables')
    expect(runtime.stateOf('variables')).toBe('registered')
  })
})
