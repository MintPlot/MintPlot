import { describe, expect, it } from 'vitest'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { mirrorSecretBundleIntoVault } from '@/kernel/secrets/vault-feed'

/**
 * Vault mirror feed — the composition root loans plugin secrets from the
 * vault, fed from the secret channel's extracted bundle (boot + every
 * settings write). The channel shape is `{'/path/to/field': value}`.
 */

describe('kernel/secrets · vault mirror feed', () => {
  it('mirrors top-level secret fields so plugin loans resolve', async () => {
    const vault = createSecretsVault()
    mirrorSecretBundleIntoVault(JSON.stringify({ '/ttsCloudApiKey': 'sk-cloud-1' }), vault)

    await expect(vault.use('ttsCloudApiKey', (key) => key)).resolves.toBe('sk-cloud-1')
  })

  it('collapses nested profile keys onto the field name (last write wins)', async () => {
    const vault = createSecretsVault()
    mirrorSecretBundleIntoVault(
      JSON.stringify({
        '/llmProvider/apiKey': 'legacy',
        '/apiProfiles/a/apiKey': 'k1',
        '/apiProfiles/b/apiKey': 'k2',
      }),
      vault,
    )

    // Documented collapse: no plugin loans `apiKey` today (the LLM path reads
    // the repository) — the assertion pins the behavior for future consumers.
    await expect(vault.use('apiKey', (key) => key)).resolves.toBe('k2')
  })

  it('mirrors cleared fields as empty strings, and the vault rejects empty loans', async () => {
    const vault = createSecretsVault()
    vault.setSecret('ttsCloudApiKey', 'stale')
    mirrorSecretBundleIntoVault(JSON.stringify({ '/ttsCloudApiKey': '' }), vault)

    // An empty string is "user cleared the field" — as good as unset, so a
    // stale loan never resolves with the old value.
    await expect(vault.use('ttsCloudApiKey', (key) => key)).rejects.toThrow('ttsCloudApiKey')
  })

  it('skips non-string values', async () => {
    const vault = createSecretsVault()
    mirrorSecretBundleIntoVault(
      JSON.stringify({ '/ttsCloudApiKey': 42, '/nested/apiKey': null }),
      vault,
    )

    await expect(vault.use('ttsCloudApiKey', (key) => key)).rejects.toThrow('ttsCloudApiKey')
  })

  it('tolerates empty, null and corrupt bundles without throwing', async () => {
    const vault = createSecretsVault()
    expect(() => mirrorSecretBundleIntoVault(null, vault)).not.toThrow()
    expect(() => mirrorSecretBundleIntoVault(undefined, vault)).not.toThrow()
    expect(() => mirrorSecretBundleIntoVault('', vault)).not.toThrow()
    expect(() => mirrorSecretBundleIntoVault('{not json', vault)).not.toThrow()

    await expect(vault.use('ttsCloudApiKey', (key) => key)).rejects.toThrow('ttsCloudApiKey')
  })
})
