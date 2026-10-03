/**
 * Platform secret channel (M4-b2, ADR-005) — the kernel-owned channel policy
 * (same SecretChannel interface, same key whitelist) over a shell bridge
 * payload store. The Java side (`SecretVaultPlugin`, registered by
 * MainActivity) is shell infrastructure — no manifest, no product plugin
 * lifecycle; it only persists channel payloads encrypted at rest
 * (AndroidKeyStore AES-GCM). Without the native shell (pure web, tests) this
 * degrades to the session-only memory channel: plaintext-at-rest stays an
 * unacceptable fallback (ported stance).
 */

import { assertSecretKey, createMemorySecretChannel } from '@/kernel/secrets/secret-channel'
import type { SecretChannel } from '@/kernel/secrets/secret-channel'

interface MpVaultBridge {
  secretSet(options: { key: string; value: string }): Promise<void>
  secretGet(options: { key: string }): Promise<{ value?: string | null } | undefined>
  secretRemove(options: { key: string }): Promise<void>
}

/** Lazy per-operation detection — the Capacitor bridge may land after first use. */
function detectBridge(): MpVaultBridge | null {
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, MpVaultBridge> } }).Capacitor?.Plugins
  const candidate = plugins?.MpVault
  if (!candidate || typeof candidate.secretGet !== 'function' || typeof candidate.secretSet !== 'function') return null
  return candidate
}

export function createPlatformSecretChannel(): SecretChannel {
  return {
    async setSecret(key, value) {
      assertSecretKey(key)
      const bridge = detectBridge()
      if (!bridge) return createMemoryFallback().setSecret(key, value)
      await bridge.secretSet({ key, value })
    },
    async getSecret(key) {
      assertSecretKey(key)
      const bridge = detectBridge()
      if (!bridge) return createMemoryFallback().getSecret(key)
      const response = await bridge.secretGet({ key })
      return response?.value ?? null
    },
    async removeSecret(key) {
      assertSecretKey(key)
      const bridge = detectBridge()
      if (!bridge) return createMemoryFallback().removeSecret(key)
      await bridge.secretRemove({ key })
    },
  }
}

// One shared memory fallback instance per channel — session-scoped, matching
// the standalone memory channel semantics.
let fallback: SecretChannel | null = null
function createMemoryFallback(): SecretChannel {
  fallback ??= createMemorySecretChannel()
  return fallback
}
