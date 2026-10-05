/**
 * Secrets vault (M2 minimal) — R-11 step one: controlled loans. The plaintext
 * enters only the callback scope of {@link SecretsVault.use}; outside the
 * native shell secrets stay session-only in memory (plaintext-at-rest fallback
 * is rejected — the stance ported from RP's storage repository). The native
 * secure channel and the key input face land with M3.
 */

import type { MaybePromise } from '@contracts'

export interface SecretsVault {
  /** Kernel-only write path (M3 key input face); plugins never see it. */
  setSecret(key: string, value: string): void
  /** Single-shot transient loan; reading an unset secret throws (diagnosed upstream). */
  use<T>(key: string, fn: (secret: string) => MaybePromise<T>): Promise<T>
}

export function createSecretsVault(): SecretsVault {
  const secrets = new Map<string, string>()
  return {
    setSecret(key, value) {
      secrets.set(key, value)
    },
    async use<T>(key: string, fn: (secret: string) => MaybePromise<T>): Promise<T> {
      const secret = secrets.get(key)
      // An empty string means the user cleared the field — as good as unset
      // (the vault feed mirrors cleared fields so stale loans never resolve).
      if (secret === undefined || secret === '') {
        throw new Error(`[secrets] secret "${key}" is not set`)
      }
      return await fn(secret)
    },
  }
}
