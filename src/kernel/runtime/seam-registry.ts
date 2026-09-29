/**
 * Capability seam registry (ADR-001 §4.3, R-09) — Definition / Provider /
 * Consumer. The kernel owns the seam definitions (llm.provider / tts.engine /
 * image.gen land with their M3 subsystems); this registry holds the provider
 * half: plugins register implementations via ctx, consumers resolve, and
 * removing a provider falls consumers back to the default implementation.
 * Every provider change broadcasts `seam.provider.changed`.
 */

import type { Disposer } from '@contracts'

export interface SeamProvider {
  readonly seamId: string
  readonly pluginId: string
  readonly implementation: unknown
}

export interface SeamRegistry {
  register(pluginId: string, seamId: string, implementation: unknown): Disposer
  /** Latest registered active provider, or null (consumers fall back to default). */
  resolve(seamId: string): SeamProvider | null
}

export function createSeamRegistry(onChange: (seamId: string, providerPluginId: string | null) => void): SeamRegistry {
  const providers = new Map<string, SeamProvider[]>()

  const currentOf = (seamId: string): SeamProvider | null => {
    const list = providers.get(seamId)
    return list && list.length > 0 ? list[list.length - 1]! : null
  }

  return {
    register(pluginId, seamId, implementation) {
      let list = providers.get(seamId)
      if (!list) {
        list = []
        providers.set(seamId, list)
      }
      const provider: SeamProvider = { seamId, pluginId, implementation }
      list.push(provider)
      onChange(seamId, pluginId)
      return () => {
        const remaining = providers.get(seamId)
        if (!remaining) return
        const index = remaining.indexOf(provider)
        if (index >= 0) remaining.splice(index, 1)
        const current = currentOf(seamId)
        onChange(seamId, current ? current.pluginId : null)
      }
    },
    resolve(seamId) {
      return currentOf(seamId)
    },
  }
}
