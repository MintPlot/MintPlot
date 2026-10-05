/**
 * Vault feed (M3 key input face) — `ctx.secrets.use(key)` loans values users
 * type into secret-shaped settings fields, but the vault never had a writer
 * (cloud TTS stayed unconfigured forever). The composition root mirrors the
 * secret channel's bundle for the settings key into the vault — at boot and
 * after every settings write (the repository re-extracts secrets on write,
 * so the channel is always the freshest source).
 */

import type { SecretsVault } from '@/kernel/secrets/vault'

/**
 * Mirror one extracted secret bundle (path-keyed JSON from the channel) into
 * the vault. Bundle paths collapse to their LAST segment as the vault key —
 * plugin-loaned fields (ttsCloudApiKey) are top-level in mp_settings; nested
 * keys (apiProfiles.*.apiKey) collapse onto `apiKey`, which no plugin
 * consumes today (the LLM path reads the repository, not the vault).
 */
export function mirrorSecretBundleIntoVault(raw: string | null | undefined, vault: SecretsVault): void {
  if (!raw) return
  let secrets: Record<string, unknown>
  try {
    secrets = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  for (const [path, value] of Object.entries(secrets)) {
    const field = path.split('/').filter(Boolean).pop()
    if (field && typeof value === 'string') vault.setSecret(field, value)
  }
}
