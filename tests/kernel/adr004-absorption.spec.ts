import { describe, expect, it, vi } from 'vitest'
import { validateManifest } from '@contracts'
import { getTokenUsageCategory, normalizeApiUsage, readUsageNumber } from '@contracts'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createSettingsState, SETTINGS_STORAGE_KEY } from '@/kernel/settings/settings-state'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

describe('ADR-004 absorption · seam providerId dimension', () => {
  it('registers named providers and resolves by id or latest', () => {
    const changes: string[] = []
    const registry = createSeamRegistry((seamId, pluginId) => changes.push(`${seamId}:${pluginId}`))

    const removeSystem = registry.register('tts', 'tts.engine', { kind: 'system' }, 'system')
    registry.register('tts', 'tts.engine', { kind: 'cloud' }, 'cloud')

    expect(registry.listProviders('tts.engine')).toEqual(['system', 'cloud'])
    expect(registry.resolve('tts.engine', 'system')?.implementation).toEqual({ kind: 'system' })
    expect(registry.resolve('tts.engine')?.providerId).toBe('cloud')
    expect(registry.resolve('tts.engine', 'missing')).toBeNull()

    // Removing the latest falls consumers back to the remaining provider.
    removeSystem()
    expect(registry.resolve('tts.engine')?.providerId).toBe('cloud')
  })
})

describe('ADR-004 absorption · settings scope (host settings state)', () => {
  function makeRepository() {
    return createStorageRepository(createMemoryEngine())
  }

  it('scope returns a live projection that persists through the repository', async () => {
    vi.useFakeTimers()
    const repository = makeRepository()
    const state = createSettingsState(repository)
    await vi.advanceTimersByTimeAsync(0)

    const settings = state.scope(['ttsService', 'ttsRate'])
    settings.ttsService = 'cloud'
    settings.ttsRate = 1.2

    // Live: reads track writes without awaiting persistence.
    expect(settings.ttsService).toBe('cloud')
    expect(state.scope(['ttsService']).ttsService).toBe('cloud')

    await state.flush()
    const stored = await repository.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    expect(stored).toMatchObject({ ttsService: 'cloud', ttsRate: 1.2 })
    vi.useRealTimers()
  })

  it('secret-shaped fields ride the mp_settings secret channel, not the plain value', async () => {
    vi.useFakeTimers()
    const engine = createMemoryEngine()
    const repository = createStorageRepository(engine)
    const state = createSettingsState(repository)
    await vi.advanceTimersByTimeAsync(0)

    const settings = state.scope(['ttsCloudApiKey'])
    settings.ttsCloudApiKey = 'sk-secret'
    await state.flush()

    // The RAW engine holds the blanked value; the vault restores on read.
    const raw = JSON.parse((await engine.get(SETTINGS_STORAGE_KEY))!) as Record<string, unknown>
    expect(raw.ttsCloudApiKey).toBe('')
    const reread = createSettingsState(repository)
    await vi.advanceTimersByTimeAsync(0)
    expect(reread.scope(['ttsCloudApiKey']).ttsCloudApiKey).toBe('sk-secret')
    vi.useRealTimers()
  })
})

describe('ADR-004 absorption · session projection stubs', () => {
  it('returns card-domain empties until the card-workshop port lands', () => {
    const session = createSessionProjection()
    expect(session.getCharacterName()).toBe('')
    expect(session.getCharacterVoice()).toBe('')
    expect(session.getMessageAt(0)).toBeNull()
  })
})

describe('ADR-004 absorption · manifest settingsScope validation', () => {
  it('accepts a string list and rejects non-strings or empty keys', () => {
    const ok = validateManifest({
      id: 'scoped', version: '1.0.0', entry: './index.ts', activation: 'lazy',
      permissions: ['settings.section'],
      extensionPoints: { settingsScope: ['ttsService', 'ttsRate'] },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.manifest.extensionPoints?.settingsScope).toEqual(['ttsService', 'ttsRate'])

    const bad = validateManifest({
      id: 'scoped', version: '1.0.0', entry: './index.ts', activation: 'lazy',
      permissions: [],
      extensionPoints: { settingsScope: ['ok', ''] },
    })
    expect(bad.ok).toBe(false)
  })
})

describe('ADR-004 absorption · token-format (ported pure functions)', () => {
  it('categorizes usage types and formats counts', () => {
    expect(getTokenUsageCategory('chat')).toBe('chat')
    expect(getTokenUsageCategory('summary')).toBe('memory')
    expect(getTokenUsageCategory('embedding')).toBe('memory')
    expect(getTokenUsageCategory('ui_template')).toBe('variables')

    expect(readUsageNumber('120', 5)).toBe(120)
    expect(readUsageNumber(-1, 'abc')).toBeNull()
  })

  it('normalizes provider usage shapes into one record', () => {
    const openai = normalizeApiUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 40 },
    })
    expect(openai).toMatchObject({ inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 40, reported: true })

    const gemini = normalizeApiUsage({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
    })
    expect(gemini).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

    expect(normalizeApiUsage(null).reported).toBe(false)
  })
})
