/**
 * Plugin runtime (ADR-001 §02 duty 5) — registry, lifecycle state machine,
 * PluginContext issuing, disposer revocation, permission gating and the event
 * bus hookup. This is the M2 minimal closed loop:
 *
 *   load        manifest validation + static permission check + dedupe;
 *               no business logic, no kernel state touched (R-04).
 *   activate    the only registration window; a throw rolls back every
 *               registration already performed (bag drained LIFO, R-04).
 *   deactivate  the bag drains LIFO, then the plugin's own deactivate hook
 *               runs; full revocation despite individual errors (errors are
 *               aggregated after every disposer has run).
 *   unload      no runtime loader before external-plugin support (R6):
 *               unload ≡ deactivate; real unloading is defined then.
 *
 * Error isolation: plugin exceptions never take down the kernel; they are
 * journaled and rethrown to the caller. Degraded marking (repeated errors /
 * quota exhaustion) attaches when the M3 pipeline gives the runtime dispatch
 * surfaces to count errors on.
 */

import type {
  DisposerBag,
  MaybePromise,
  PluginDefinition,
  PluginManifest,
  PluginRuntimeState,
  TransientEventMap,
} from '@contracts'
import { validateManifest } from '@contracts'
import { createPluginContext, createActivationBag } from '@/kernel/runtime/context'
import type { KernelServices } from '@/kernel/runtime/context'

export interface PluginRecord {
  readonly definition: PluginDefinition
  readonly manifest: PluginManifest
  state: PluginRuntimeState
}

export interface PluginStateProjection {
  readonly id: string
  readonly version: string
  readonly activation: 'eager' | 'lazy'
  readonly state: PluginRuntimeState
  readonly permissions: readonly string[]
  readonly sessions: readonly string[] | undefined
}

export class PluginLoadError extends Error {
  constructor(
    readonly pluginId: string,
    readonly errors: { path: string; message: string }[],
  ) {
    super(`[runtime] plugin "${pluginId}" failed manifest validation: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`)
    this.name = 'PluginLoadError'
  }
}

export class PluginActivationError extends Error {
  constructor(
    readonly pluginId: string,
    readonly cause: unknown,
  ) {
    super(`[runtime] plugin "${pluginId}" failed activation; all registrations rolled back`)
    this.name = 'PluginActivationError'
  }
}

export interface PluginRuntime {
  /** Load a definition (build-time registry step); validates the manifest. */
  load(definition: PluginDefinition): void
  /** Activate the only registration window; rolls back fully on failure. */
  activate(id: string): MaybePromise<void>
  /** Drain the bag LIFO, run the plugin's own deactivate, broadcast the state. */
  deactivate(id: string): MaybePromise<void>
  /** R-04: no runtime loader before R6 — unload ≡ deactivate. */
  unload(id: string): MaybePromise<void>
  isActive(id: string): boolean
  stateOf(id: string): PluginRuntimeState | undefined
  projection(): readonly PluginStateProjection[]
  /** Runtime journal (permission denials, lifecycle anomalies) per plugin. */
  journalOf(id: string): readonly string[]
  /** Broadcast `plugin.state.changed` (exposed so the bootstrap can wire the bus). */
  readonly emit: <K extends keyof TransientEventMap>(type: K, event: TransientEventMap[K]) => void
}

export function createPluginRuntime(services: KernelServices): PluginRuntime {
  const records = new Map<string, PluginRecord>()
  const bags = new Map<string, DisposerBag>()
  const journals = new Map<string, string[]>()
  const inFlight = new Set<string>()

  const journal = (id: string, entry: string): void => {
    let list = journals.get(id)
    if (!list) {
      list = []
      journals.set(id, list)
    }
    list.push(entry)
  }

  const broadcast = (id: string, state: PluginRuntimeState): void => {
    services.bus.emit('plugin.state.changed', { pluginId: id, state })
  }

  const record = (id: string): PluginRecord => {
    const found = records.get(id)
    if (!found) throw new Error(`[runtime] plugin "${id}" is not loaded`)
    return found
  }

  const emit = <K extends keyof TransientEventMap>(type: K, event: TransientEventMap[K]): void => {
    services.bus.emit(type, event)
  }

  return {
    load(definition) {
      const id = definition.manifest.id
      const validated = validateManifest(definition.manifest)
      if (!validated.ok) throw new PluginLoadError(id, validated.errors)
      if (records.has(id)) throw new Error(`[runtime] plugin id "${id}" already loaded (ids are repo-unique, R-03)`)
      records.set(id, { definition, manifest: validated.manifest, state: 'registered' })
      broadcast(id, 'registered')
    },

    async activate(id) {
      const found = record(id)
      if (found.state === 'active') throw new Error(`[runtime] plugin "${id}" is already active`)
      if (inFlight.has(id)) throw new Error(`[runtime] plugin "${id}" activation already in flight`)
      inFlight.add(id)
      const bag = createActivationBag()
      // One journal array per plugin, shared by reference: context-level denials
      // and runtime-level notes append into the same stored list.
      let notes = journals.get(id)
      if (!notes) {
        notes = []
        journals.set(id, notes)
      }
      const ctx = createPluginContext(services, found.manifest, bag, notes)
      try {
        await found.definition.activate(ctx)
      } catch (cause) {
        // Fail-safe: activation failure rolls back every registration performed.
        await bag.run().catch((rollbackError) => {
          journal(id, `activation rollback error: ${String(rollbackError)}`)
        })
        journal(id, `activation failed: ${String(cause)}`)
        throw new PluginActivationError(id, cause)
      } finally {
        inFlight.delete(id)
      }
      bags.set(id, bag)
      found.state = 'active'
      broadcast(id, 'active')
    },

    async deactivate(id) {
      const found = record(id)
      if (found.state !== 'active') throw new Error(`[runtime] plugin "${id}" is not active`)
      const bag = bags.get(id)
      const bagErrors: unknown[] = []
      if (bag) {
        try {
          await bag.run()
        } catch (error) {
          bagErrors.push(error)
        }
      }
      let definitionError: unknown
      try {
        await found.definition.deactivate?.()
      } catch (error) {
        definitionError = error
      }
      bags.delete(id)
      found.state = 'registered'
      broadcast(id, 'registered')
      const failures = [bagErrors[0], definitionError].filter((e) => e !== undefined)
      if (failures.length > 0) {
        journal(id, `deactivation completed with ${failures.length} error(s) after full revocation`)
        throw new AggregateError(failures, `[runtime] plugin "${id}" deactivated with errors (revocation completed)`)
      }
    },

    async unload(id) {
      await this.deactivate(id)
    },

    isActive(id) {
      return records.get(id)?.state === 'active'
    },

    stateOf(id) {
      return records.get(id)?.state
    },

    projection() {
      return [...records.values()]
        .map((entry): PluginStateProjection => ({
          id: entry.manifest.id,
          version: entry.manifest.version,
          activation: entry.manifest.activation,
          state: entry.state,
          permissions: entry.manifest.permissions,
          sessions: entry.manifest.sessions,
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    },

    journalOf(id) {
      return [...(journals.get(id) ?? [])]
    },

    emit,
  }
}
