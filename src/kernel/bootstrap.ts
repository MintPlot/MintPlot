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
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createSettingsState, SETTINGS_STORAGE_KEY } from '@/kernel/settings/settings-state'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { mirrorSecretBundleIntoVault } from '@/kernel/secrets/vault-feed'
import { createPlatformSecretChannel } from '@/kernel/secrets/platform-secret-channel'
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
  // The raw engine hosts the ADR-003 key layout directly (mp_settings,
  // chat:<kind>:<id>); the repository adds secret extraction on top, backed by
  // the platform secret channel (ADR-005: encrypted at rest via the shell
  // bridge, session-only memory without the native shell).
  const secretChannel = createPlatformSecretChannel()
  const repository = createStorageRepository(createDefaultEngine(), secretChannel)
  // Vault feed (M3 key input face): `ctx.secrets.use(key)` loans values users
  // type into secret-shaped settings fields, but nothing wrote the vault —
  // cloud TTS stayed unconfigured forever. Mirror the channel's field values
  // into the vault at boot and after every settings write (the write path
  // re-extracts secrets, so the channel is always the freshest source).
  const vault = createSecretsVault()
  const feedVaultFromChannel = async (): Promise<void> => {
    const raw = await secretChannel.getSecret(`config:${SETTINGS_STORAGE_KEY}`)
    mirrorSecretBundleIntoVault(raw, vault)
  }
  const settings = createSettingsState({
    ...repository,
    async set(key, value) {
      await repository.set(key, value)
      if (key === SETTINGS_STORAGE_KEY) void feedVaultFromChannel()
    },
  })
  void feedVaultFromChannel()
  const services: KernelServices = {
    // ADR-003 default engine ladder: bare idb -> localStorage session fallback,
    // under MP's mp_ data prefix (plugin namespaces).
    storage: createKvStore(createPrefixedEngine(createDefaultEngine(), MP_STORAGE_PREFIX)),
    settings,
    session: createSessionProjection(),
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: vault,
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: inputActionsSink,
    cardPanels: cardPanelsSink,
  }
  const runtime = createPluginRuntime(services)
  return { services, runtime, storage: services.storage }
}
