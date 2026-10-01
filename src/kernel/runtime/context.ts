/**
 * PluginContext issuing (ADR-001 §03, R-05) — the runtime hands every plugin
 * its single entry point. Every registration goes through ctx, is gated by
 * the manifest's declared permissions (default deny-all, R-11) and is
 * automatically reversible: returned disposers are collected into the
 * activation's disposer bag, drained LIFO on deactivate.
 *
 * Kernel state reaches plugins only as read-only projections or narrow
 * services; nothing here hands out kernel internals.
 */

import type {
  CardPanelSectionSpec,
  Disposer,
  InputActionSpec,
  MaybePromise,
  PluginContext,
  PluginManifest,
  PluginPlatform,
  PluginSeams,
  PluginUi,
  SessionEvent,
  SessionEventFilter,
  SessionEventInput,
  SessionEventType,
  SettingsSectionSpec,
  ViewSpec,
} from '@contracts'
import { createDisposerBag } from '@contracts'
import type { DisposerBag } from '@contracts'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import type { KvStore } from '@/kernel/store/kv-store'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { SessionLedger } from '@/kernel/sessions/session-ledger'
import type { HostSessionProjection } from '@/kernel/sessions/session-projection'
import type { TransientBus } from '@/kernel/runtime/event-bus'
import type { SeamRegistry } from '@/kernel/runtime/seam-registry'
import type { HookRegistry } from '@/kernel/runtime/hooks'
import type { SecretsVault } from '@/kernel/secrets/vault'

/** Sinks the runtime pushes registrations into — the kernel app shell implements them. */
export interface ViewSink {
  registerView(pluginId: string, spec: ViewSpec): Disposer
}
export interface SettingsSink {
  registerSection(pluginId: string, spec: SettingsSectionSpec): Disposer
}
export interface InputActionSink {
  registerAction(pluginId: string, spec: InputActionSpec): Disposer
}
export interface CardPanelSink {
  registerSection(pluginId: string, spec: CardPanelSectionSpec): Disposer
}

/** UI affordances issued per plugin (ownership tracked for deactivate cleanup). */
export interface UiService {
  toast(owner: string, message: string, options?: { durationMs?: number; tone?: 'info' | 'success' | 'error' }): void
  confirm(owner: string, options: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean>
  progress(owner: string): { close(): void }
}

/** Everything the kernel hands the runtime; all of it is plugin-safe surface. */
export interface KernelServices {
  readonly storage: KvStore
  /** Full settings state (kernel-side; the ctx face narrows to the scope). */
  readonly settings: SettingsState
  /** Host projection; the PluginSession face narrows it for plugins. */
  readonly session: HostSessionProjection
  readonly ledger: SessionLedger
  readonly bus: TransientBus
  readonly seams: SeamRegistry
  readonly hooks: HookRegistry
  readonly secrets: SecretsVault
  readonly platform: PluginPlatform
  readonly ui: UiService
  readonly views: ViewSink
  readonly settingsSink: SettingsSink
  readonly inputActions: InputActionSink
  readonly cardPanels: CardPanelSink
}

export class PermissionDeniedError extends Error {
  constructor(
    pluginId: string,
    surface: string,
    permission: string,
  ) {
    super(`[runtime] plugin "${pluginId}" used ${surface} without permission "${permission}" (default deny-all, ADR-001 R-11)`)
    this.name = 'PermissionDeniedError'
  }
}

function pluginStorageNamespace(pluginId: string): string {
  return `plug:${pluginId}:`
}

/** Ledger attribution is stamped by the runtime; emitters never fake ids (audit). */
export function stampSessionEvent(event: SessionEventInput, pluginId: string): SessionEvent {
  return {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ts: Date.now(),
    pluginId,
  }
}

/**
 * Build the v1 PluginContext for one activation. `journal` collects runtime
 * notes (permission denials, lifecycle anomalies) for the diagnostics surface.
 */
export function createPluginContext(
  services: KernelServices,
  manifest: PluginManifest,
  bag: DisposerBag,
  journal: string[],
): PluginContext {
  const pluginId = manifest.id
  const permissions = new Set(manifest.permissions)

  const deny = (surface: string, permission: string): never => {
    const denial = `${surface} denied (missing permission "${permission}")`
    journal.push(denial)
    console.warn(`[runtime] plugin "${pluginId}": ${denial}`)
    throw new PermissionDeniedError(pluginId, surface, permission)
  }

  const requirePermission = (surface: string, permission: string): void => {
    if (!permissions.has(permission)) deny(surface, permission)
  }

  /** Register through a sink, collect the disposer, hand it back to the plugin. */
  const viaSink = (disposer: Disposer): Disposer => {
    bag.add(disposer)
    return disposer
  }

  const ui: PluginUi = {
    toast(message, options) {
      services.ui.toast(pluginId, message, options)
    },
    confirm(options) {
      return services.ui.confirm(pluginId, options)
    },
    progress() {
      const handle = services.ui.progress(pluginId)
      bag.add(() => handle.close())
      return handle
    },
  }

  const sessionEventType = (surface: string, type: string): SessionEventType => {
    requirePermission(surface, `session.event.emit.${type}`)
    return type as SessionEventType
  }

  return {
    pluginId,

    registerView(spec) {
      requirePermission('registerView', 'view.register')
      return viaSink(services.views.registerView(pluginId, spec))
    },

    registerSettingsSection(spec) {
      requirePermission('registerSettingsSection', 'settings.section')
      return viaSink(services.settingsSink.registerSection(pluginId, spec))
    },

    registerInputAction(spec) {
      requirePermission('registerInputAction', 'input.action')
      return viaSink(services.inputActions.registerAction(pluginId, spec))
    },

    registerCardPanelSection(spec) {
      requirePermission('registerCardPanelSection', 'card.panel.section')
      return viaSink(services.cardPanels.registerSection(pluginId, spec))
    },

    registerSeamProvider(seamId, implementation, providerId) {
      requirePermission('registerSeamProvider', `seam.provide.${seamId}`)
      return viaSink(services.seams.register(pluginId, seamId, implementation, providerId))
    },

    registerHook(point, handler, options) {
      requirePermission('registerHook', `hook.${point}`)
      return viaSink(services.hooks.register(pluginId, point, handler, options))
    },

    async emitSessionEvent(event: SessionEventInput): Promise<void> {
      sessionEventType('emitSessionEvent', event.kind)
      services.ledger.append(stampSessionEvent(event, pluginId))
    },

    onSessionEvent(filter: SessionEventFilter, handler) {
      requirePermission('onSessionEvent', 'session.event.read')
      return viaSink(services.ledger.subscribe(filter, handler))
    },

    storage: {
      get: async <T>(key: string) => services.storage.get<T>(pluginStorageNamespace(pluginId) + key),
      set: async (key, value) => services.storage.set(pluginStorageNamespace(pluginId) + key, value),
      delete: async (key) => services.storage.remove(pluginStorageNamespace(pluginId) + key),
      keys: async () => {
        const prefix = pluginStorageNamespace(pluginId)
        const all = await services.storage.keys()
        return all.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
      },
    },

    settings: {
      // Whitelist enforcement (ADR-004): only manifest-declared keys pass;
      // undeclared keys are denied and journaled (default deny-all discipline).
      scope: (keys) => {
        const declared = manifest.extensionPoints?.settingsScope
        if (declared === undefined) {
          deny('settings.scope', 'extensionPoints.settingsScope (no keys declared)')
        }
        for (const key of keys) {
          if (!(declared as readonly string[]).includes(key)) {
            deny('settings.scope', `settings key "${key}" not declared in extensionPoints.settingsScope`)
          }
        }
        return services.settings.scope(keys)
      },
    },

    session: services.session,

    seams: {
      resolve: <T = unknown>(seamId: string, providerId?: string) => services.seams.resolve<T>(seamId, providerId),
      listProviders: (seamId: string) => services.seams.listProviders(seamId),
    } satisfies PluginSeams,

    secrets: {
      use: async <T>(key: string, fn: (secret: string) => MaybePromise<T>) => {
        requirePermission('secrets.use', `secrets.read.${key}`)
        return services.secrets.use(key, fn)
      },
    },

    platform: services.platform,

    on(type, handler) {
      // Transient subscriptions auto-unsubscribe on deactivate (ADR-001 §4.4).
      const dispose = services.bus.on(type, handler)
      bag.add(dispose)
      return dispose
    },

    ui,

    diag: {
      pluginId,
      // M3-err3 formalization: plugin journal entries land in the kernel
      // error hub, attributed to the plugin (category 'plugin').
      record(entry) {
        errorHub.record({
          severity: entry.severity ?? 'info',
          category: 'plugin',
          action: entry.action,
          message: entry.message,
          code: entry.code,
          pluginId,
          context: entry.context,
        })
      },
    },

    onDeactivate(fn) {
      bag.add(fn)
    },
  }
}

/** Convenience for tests and the bootstrap: an empty bag to hand createPluginContext. */
export function createActivationBag(): DisposerBag {
  return createDisposerBag()
}
