import { describe, expect, it, vi } from 'vitest'
import { validateManifest } from '@contracts'
import UsageStatsPlugin from '@/plugins/usage-stats'
import { getUsageStatsService } from '@/plugins/usage-stats/service-instance'
import type { UsageStatsService } from '@/plugins/usage-stats/service'
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
import { getRegisteredPluginViews, pluginViewsSink } from '@/kernel/app/plugin-views'
import { settingsSink } from '@/kernel/app/settings-registry'
import { createMemorySettingsState } from '../helpers/memory-settings'

// Ported from the decoupling line's usage-stats-contract tests (baseline
// 81ef0b8): mock ctx, zero network, behavior locked. MP adaptations: the
// shell-projection case is dropped (ADR-004: not absorbed).
function makeServices(characterName = 'TestChar', confirmProbe?: { calls: { title: string; message?: string }[]; answer: boolean }) {
  const bus = createTransientBus()
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  const services: KernelServices = {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: { getCharacterName: () => characterName, getCharacterVoice: () => '', getMessageAt: () => null },
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: confirmProbe
      ? {
          ...uiService,
          toast: () => {},
          confirm: async (_owner: string, options: { title: string; message?: string }) => {
            confirmProbe.calls.push(options)
            return confirmProbe.answer
          },
        }
      : uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: { registerAction: () => () => {} },
    cardPanels: { registerSection: () => () => {} },
  }
  return services
}

async function activatePlugin(characterName = 'TestChar'): Promise<{ service: UsageStatsService; runtime: ReturnType<typeof createPluginRuntime>; services: KernelServices }> {
  const services = makeServices(characterName)
  const runtime = createPluginRuntime(services)
  runtime.load(UsageStatsPlugin)
  await runtime.activate('usage-stats')
  const service = getUsageStatsService()
  if (!service) throw new Error('usage-stats service not mounted')
  return { service, runtime, services }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('usage-stats · manifest (ported, R-03)', () => {
  it('declares view.register and its own view only', () => {
    const result = validateManifest(UsageStatsPlugin.manifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('usage-stats')
    expect(result.manifest.activation).toBe('lazy')
    expect(result.manifest.permissions).toEqual(['view.register'])
    expect(result.manifest.extensionPoints?.views).toEqual(['usage'])
  })
})

describe('usage-stats · service behavior (ported, mock ctx)', () => {
  it('record → filter → stats pipeline works on the namespaced store', async () => {
    const { service, runtime, services } = await activatePlugin()
    await flush()

    service.recordApiUsage({ prompt_tokens: 100, completion_tokens: 50 }, { type: 'chat', model: 'test-model' })
    // summary/embedding types filter into the memory category
    service.recordApiUsage({ prompt_tokens: 10, completion_tokens: 5 }, { type: 'summary', model: 'mem-model', detail: 'summary' })
    await flush()

    expect(service.tokenUsageHistory.value).toHaveLength(2)
    expect(service.tokenUsageHistory.value[0]?.type).toBe('summary')
    expect(service.tokenUsageHistory.value[0]?.characterName).toBe('TestChar')
    expect(service.tokenUsageFilter.value).toBe('all')

    service.tokenUsageFilter.value = 'memory'
    expect(service.filteredTokenUsageHistory.value).toHaveLength(1)
    expect(service.tokenUsageStats.value.outputTokens).toBe(5)
    service.tokenUsageFilter.value = 'all'

    expect(service.tokenUsageStats.value.inputTokens).toBe(110)
    expect(service.tokenUsageStats.value.outputTokens).toBe(55)
    expect(service.tokenUsageStats.value.inputTokensReports).toBe(2)

    expect(service.latestMainTokenUsage.value?.model).toBe('test-model')

    // Persistence lands under the plugin namespace (kernel prefixes it).
    service.recordApiUsage({ prompt_tokens: 1 }, { type: 'chat' })
    await flush()
    const keys = await services.storage.keys()
    expect(keys.every((key) => key.startsWith('plug:usage-stats:'))).toBe(true)

    await runtime.deactivate('usage-stats')
    expect(getUsageStatsService()).toBeNull()
  })

  it('register view joins the plugin view registry and revokes on deactivate', async () => {
    const { runtime } = await activatePlugin()
    expect(getRegisteredPluginViews().map((view) => view.id)).toContain('usage-stats:usage')

    await runtime.deactivate('usage-stats')
    expect(getRegisteredPluginViews().some((view) => view.id === 'usage-stats:usage')).toBe(false)
  })

  it('clear requires the host confirm dialog', async () => {
    vi.useRealTimers()
    // Refused path: the confirm dialog is the only clear route.
    const refusedProbe: { calls: { title: string; message?: string }[]; answer: boolean } = { calls: [], answer: false }
    const services = makeServices('TestChar', refusedProbe)
    const runtime = createPluginRuntime(services)
    runtime.load(UsageStatsPlugin)
    await runtime.activate('usage-stats')
    const refused = getUsageStatsService()!
    await flush()
    refused.recordApiUsage({ prompt_tokens: 1 }, {})
    await flush()
    refused.clearTokenUsageHistory()
    await flush()
    expect(refusedProbe.calls).toHaveLength(1)
    expect(refusedProbe.calls[0]!.message).toMatch(/无法撤销/)
    expect(refused.tokenUsageHistory.value).toHaveLength(1)
    await runtime.deactivate('usage-stats')

    // Accepted path.
    const acceptedProbe: { calls: { title: string; message?: string }[]; answer: boolean } = { calls: [], answer: true }
    const services2 = makeServices('TestChar', acceptedProbe)
    const runtime2 = createPluginRuntime(services2)
    runtime2.load(UsageStatsPlugin)
    await runtime2.activate('usage-stats')
    const accepted = getUsageStatsService()!
    await flush()
    accepted.recordApiUsage({ prompt_tokens: 1 }, {})
    await flush()
    accepted.clearTokenUsageHistory()
    await flush()
    expect(accepted.tokenUsageHistory.value).toHaveLength(0)
  })
})
