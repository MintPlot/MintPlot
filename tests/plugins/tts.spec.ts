import { describe, expect, it } from 'vitest'
import { validateManifest } from '@contracts'
import TtsPlugin from '@/plugins/tts'
import { getTtsService } from '@/plugins/tts/service-instance'
import ttsText from '@/plugins/tts/tts-text'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { KernelServices } from '@/kernel/runtime/context'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import { createKvStore, createMemoryEngine, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { uiService } from '@/kernel/ui/toasts'
import { pluginViewsSink } from '@/kernel/app/plugin-views'
import { settingsSink } from '@/kernel/app/settings-registry'
import { cardPanelsSink, inputActionsSink } from '@/kernel/app/registration-sinks'
import { createMemorySettingsState } from '../helpers/memory-settings'

// Ported from the decoupling line's tts organ contract tests (baseline
// 81ef0b8, the ADR-001 Phase 1 pilot): manifest gate, seam dual-provider
// registration, settings-scope whitelist, secret loan into the engine.
function makeServices(): KernelServices {
  const bus = createTransientBus()
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  return {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: createSessionProjection(),
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: inputActionsSink,
    cardPanels: cardPanelsSink,
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('tts · manifest (ported, R-03/R-11)', () => {
  it('declares the pilot permission trio, the seam and the settings scope', () => {
    const result = validateManifest(TtsPlugin.manifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('tts')
    expect(result.manifest.activation).toBe('lazy')
    expect(result.manifest.permissions).toEqual([
      'seam.provide.tts.engine',
      'settings.section',
      'secrets.read.ttsCloudApiKey',
    ])
    expect(result.manifest.extensionPoints?.provide).toEqual(['tts.engine'])
    expect(result.manifest.extensionPoints?.settingsScope).toContain('ttsCloudApiKey')
    expect(result.manifest.extensionPoints?.settings).toEqual([{ id: 'tts', title: '语音设置' }])
  })
})

describe('tts · full lifecycle through the runtime', () => {
  it('registers dual seam providers + settings section; revoke on deactivate', async () => {
    const services = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(TtsPlugin)
    await runtime.activate('tts')

    expect(services.seams.listProviders('tts.engine')).toEqual(['system', 'cloud'])
    expect(services.seams.resolve('tts.engine', 'system')).not.toBeNull()
    expect(services.seams.resolve('tts.engine', 'cloud')).not.toBeNull()

    const { getRegisteredSettingsSections } = await import('@/kernel/app/settings-registry')
    expect(getRegisteredSettingsSections().map((section) => section.id)).toContain('tts:tts')

    const service = getTtsService()
    expect(service).not.toBeNull()

    await runtime.deactivate('tts')
    expect(services.seams.resolve('tts.engine', 'system')).toBeNull()
    expect(getRegisteredSettingsSections().some((section) => section.id === 'tts:tts')).toBe(false)
    expect(getTtsService()).toBeNull()
  })

  it('the service resolves both engines by providerId and syncs cloud config via the secret loan', async () => {
    const services = makeServices()
    services.secrets.setSecret('ttsCloudApiKey', 'sk-loan-test')
    const runtime = createPluginRuntime(services)
    runtime.load(TtsPlugin)
    await runtime.activate('tts')
    const service = getTtsService()!
    await flush()

    // Simulate the user configuring the cloud engine through the settings
    // scope (whitelisted keys only).
    service.settings.ttsService = 'cloud'
    service.settings.ttsCloudProviderId = 'openai'
    service.settings.ttsCloudBaseUrl = 'https://api.example.com/v1'
    service.settings.ttsCloudModel = 'tts-1'
    await flush()

    const available = await service.refreshTtsStatus()
    expect(available).toBe(true)

    const cloud = services.seams.resolve<{ isAvailable?: () => boolean; getStatus: () => { available: boolean } }>('tts.engine', 'cloud')!.implementation
    expect(cloud.isAvailable?.()).toBe(true)

    await runtime.deactivate('tts')
  })

  it('settings scope rejects keys outside the declared whitelist', async () => {
    const services = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(TtsPlugin)
    await runtime.activate('tts')

    const rogue = {
      manifest: {
        id: 'rogue-scope', version: '1.0.0', entry: './index.ts', activation: 'lazy' as const,
        permissions: [],
        extensionPoints: { settingsScope: ['someOtherKey'] },
      },
      activate: (ctx: { settings: { scope(keys: string[]): unknown } }) => {
        ctx.settings.scope(['ttsEnabled'])
      },
    }
    runtime.load(rogue)
    let error: unknown = null
    try {
      await runtime.activate('rogue-scope')
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).cause).toMatchObject({
      message: expect.stringContaining('settings key "ttsEnabled" not declared'),
    })
    expect(runtime.journalOf('rogue-scope').some((entry) => entry.includes('settings key "ttsEnabled" not declared'))).toBe(true)
  })
})

describe('tts · text extraction and chunking (ported logic)', () => {
  it('extractSpeakText strips CoT, code fences, markdown and html docs', () => {
    expect(ttsText.extractSpeakText('<think>hidden</think>你好呀')).toBe('你好呀')
    expect(ttsText.extractSpeakText('正文```code```后续')).toBe('正文 后续')
    expect(ttsText.extractSpeakText('**加粗**与[链接](https://x.y)')).toBe('加粗与链接')
    expect(ttsText.extractSpeakText('<!doctype html><html><body>网页</body></html>')).toBe('')
    // Dialogue-only keeps quoted speech.
    expect(ttsText.extractSpeakText('她说「早上好」然后离开', { dialogueOnly: true })).toBe('早上好')
    // Long text truncates at a sentence boundary.
    const long = '第一句。'.repeat(500)
    expect(ttsText.extractSpeakText(long, { maxChars: 100 }).length).toBeLessThanOrEqual(102)
  })

  it('splitSpeechChunks cuts at sentence boundaries and keeps closers attached', () => {
    expect(ttsText.splitSpeechChunks('')).toEqual([])
    expect(ttsText.splitSpeechChunks('短句')).toEqual(['短句'])
    const chunks = ttsText.splitSpeechChunks('第一句话。第二句话。第三句话。', 6)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(8)
      expect(chunk.endsWith('。')).toBe(true)
    }
  })
})
