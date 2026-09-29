/**
 * Kernel bootstrap (composition root helper) — assembles the kernel services
 * and the plugin runtime. Plugin definitions are NOT imported here: the
 * composition root (src/main.ts) owns which plugins load, keeping
 * src/kernel/** free of plugin imports (red line, ESLint-enforced).
 */

import { createPluginRuntime } from '@/kernel/runtime/runtime'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import type { PluginRuntime } from '@/kernel/runtime/runtime'
import type { KernelServices } from '@/kernel/runtime/context'
import { createKvStore, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import type { KvStore } from '@/kernel/store/kv-store'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { uiService } from '@/kernel/ui/toasts'
import { settingsSink } from '@/kernel/app/settings-registry'
import { pluginViewsSink } from '@/kernel/app/plugin-views'
import { cardPanelsSink, inputActionsSink } from '@/kernel/app/registration-sinks'

export interface MpKernel {
  /** Plugin-safe services (the same projection the runtime hands plugins). */
  readonly services: KernelServices
  readonly runtime: PluginRuntime
  /** Kernel root KV (plugin contexts namespace under `plug:<id>:`). */
  readonly storage: KvStore
}

export function createKernel(): MpKernel {
  const bus = createTransientBus()
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  const services: KernelServices = {
    // ADR-003 default engine ladder: bare idb -> localStorage session fallback,
    // under MP's mp_ data prefix.
    storage: createKvStore(createPrefixedEngine(createDefaultEngine(), MP_STORAGE_PREFIX)),
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settings: settingsSink,
    inputActions: inputActionsSink,
    cardPanels: cardPanelsSink,
  }
  const runtime = createPluginRuntime(services)
  return { services, runtime, storage: services.storage }
}
