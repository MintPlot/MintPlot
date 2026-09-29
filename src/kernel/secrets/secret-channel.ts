/**
 * Secret channel (ported from RP `src/modules/storage-repository.mjs` secret
 * half, baseline 4fedffd) — field-level secret extraction out of values that
 * would otherwise reach plain persistence, plus the whitelist-guarded secret
 * store. This is the kernel/secrets half of the R-01 split: KV body in
 * kernel/store, secret extraction here.
 *
 * MP adaptations: secret-bearing keys and the channel whitelist re-keyed to
 * MP's `mp_` data namespace (RP 存量 `rp_hub_*` keys map over via the M4
 * importer); outside the native shell the channel is session-only memory —
 * plaintext-at-rest secrets stay an unacceptable fallback (ported stance).
 * The Android secure channel lands with the M3 native shell batch.
 */

/** Field names whose values never reach plain persistence. */
const SECRET_FIELD_PATTERN = /^(apiKey|imageGenKey|apiProviderKeys|tavilyApiKey|ttsCloudApiKey)$/i

/** MP keys whose values ride the secret channel (whitelist, two listings kept in sync). */
const SECRET_BEARING_KEY_PATTERN = /^mp_(settings|active_tools)$/

/** Channel keys: only whitelisted data keys may read/write secrets. */
const SECRET_CHANNEL_KEY_PATTERN = /^config:mp_(settings|active_tools)$/

export function isSecretBearingKey(key: string): boolean {
  return SECRET_BEARING_KEY_PATTERN.test(String(key))
}

export function assertSecretKey(key: string): void {
  if (!SECRET_CHANNEL_KEY_PATTERN.test(String(key))) {
    throw new Error(`[secret-channel] secret access denied for key "${key}"`)
  }
}

export interface ExtractedValue {
  publicValue: unknown
  secrets: Record<string, unknown>
}

/** Deep-clones `value` and pulls secret fields out into a path-keyed map. */
export function extractSecrets(value: unknown): ExtractedValue {
  const secrets: Record<string, unknown> = {}
  const walk = (item: unknown, path = ''): unknown => {
    if (Array.isArray(item)) return item.map((entry, index) => walk(entry, `${path}/${index}`))
    if (!item || typeof item !== 'object') return item
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(item)) {
      const entryPath = `${path}/${key}`
      if (SECRET_FIELD_PATTERN.test(key)) {
        secrets[entryPath] = entry
        output[key] = Array.isArray(entry) ? [] : entry && typeof entry === 'object' ? {} : ''
      } else {
        output[key] = walk(entry, entryPath)
      }
    }
    return output
  }
  return { publicValue: walk(cloneJson(value)), secrets }
}

/** Re-injects extracted secrets into their original paths (structure-aware). */
export function restoreSecrets<T>(value: T, secrets: Record<string, unknown>): T {
  const result = cloneJson(value)
  for (const [path, secret] of Object.entries(secrets ?? {})) {
    const parts = path.split('/').filter(Boolean)
    let target = result as Record<string, unknown> | null
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (target?.[parts[index]!] === undefined) {
        // Structure drift would silently drop keys ("API key vanished" bugs);
        // leave a trace instead (ported lesson).
        console.warn(`[secret-channel] secret path "${path}" no longer matches stored structure; value dropped`)
        return result
      }
      target = target[parts[index]!] as Record<string, unknown> | null
    }
    if (target && parts.length) target[parts[parts.length - 1]!] = secret
  }
  return result
}

export function cloneJson<T>(value: T): T {
  return (value === undefined ? undefined : JSON.parse(JSON.stringify(value))) as T
}

/** Where extracted secrets live: native secure store, memory until then. */
export interface SecretChannel {
  setSecret(key: string, value: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  removeSecret(key: string): Promise<void>
}

/** Session-only memory channel — the explicit non-native fallback (R-11 stance). */
export function createMemorySecretChannel(): SecretChannel {
  const secrets = new Map<string, string>()
  return {
    async setSecret(key, value) {
      assertSecretKey(key)
      secrets.set(key, value)
    },
    async getSecret(key) {
      assertSecretKey(key)
      return secrets.get(key) ?? null
    },
    async removeSecret(key) {
      assertSecretKey(key)
      secrets.delete(key)
    },
  }
}
