/**
 * Capability seam registry (ADR-001 §4.3, R-09; providerId dimension per
 * ADR-004) — Definition / Provider / Consumer. One seam may carry several
 * named providers ('system' / 'cloud' / …); resolving without a providerId
 * yields the latest registered one, and removing a provider falls consumers
 * back to the remaining default. Every provider change broadcasts
 * `seam.provider.changed`.
 */

import type { Disposer } from '@contracts'
import type { SeamResolveResult } from '@contracts'

export interface SeamProvider {
  readonly seamId: string
  readonly pluginId: string
  readonly providerId: string
  readonly implementation: unknown
}

export interface SeamRegistry {
  register(pluginId: string, seamId: string, implementation: unknown, providerId?: string): Disposer
  /** Named provider, or the latest registered one when providerId is omitted. */
  resolve<T = unknown>(seamId: string, providerId?: string): SeamResolveResult<T> | null
  listProviders(seamId: string): readonly string[]
}

export function createSeamRegistry(onChange: (seamId: string, providerPluginId: string | null) => void): SeamRegistry {
  const providers = new Map<string, SeamProvider[]>()

  const list = (seamId: string): SeamProvider[] => providers.get(seamId) ?? []

  return {
    register(pluginId, seamId, implementation, providerId) {
      const provider: SeamProvider = {
        seamId,
        pluginId,
        providerId: providerId ?? pluginId,
        implementation,
      }
      let bucket = providers.get(seamId)
      if (!bucket) {
        bucket = []
        providers.set(seamId, bucket)
      }
      bucket.push(provider)
      onChange(seamId, pluginId)
      return () => {
        const remaining = providers.get(seamId)
        if (!remaining) return
        const index = remaining.indexOf(provider)
        if (index >= 0) remaining.splice(index, 1)
        const current = remaining[remaining.length - 1]
        onChange(seamId, current ? current.pluginId : null)
      }
    },

    resolve(seamId, providerId) {
      const bucket = list(seamId)
      if (bucket.length === 0) return null
      const provider = providerId === undefined
        ? bucket[bucket.length - 1]!
        : bucket.find((entry) => entry.providerId === providerId)
      if (!provider) return null
      return { providerId: provider.providerId, pluginId: provider.pluginId, implementation: provider.implementation as never }
    },

    listProviders(seamId) {
      return list(seamId).map((provider) => provider.providerId)
    },
  }
}
