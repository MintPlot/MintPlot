import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { validateManifest } from '@contracts'
import UpdateCheckerPlugin from '@/plugins/update-checker'
import { compareVersions, checkForUpdate, downloadApk, saveAndInstallApk } from '@/plugins/update-checker/service'
import { getActiveService } from '@/plugins/update-checker/service-instance'
import UpdateCheckerSection from '@/plugins/update-checker/UpdateCheckerSection.vue'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { KernelServices } from '@/kernel/runtime/context'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import { createKvStore, createMemoryEngine, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { MP_VERSION_NAME } from '@/kernel/app/app-identity'
import { uiService } from '@/kernel/ui/toasts'
import { getRegisteredSettingsSections, settingsSink } from '@/kernel/app/settings-registry'
import { createMemorySettingsState } from '../helpers/memory-settings'

function makeServices(): KernelServices {
  const bus = createTransientBus()
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  return {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: { getCharacterName: () => '', getCharacterVoice: () => '', getMessageAt: () => null, setActiveCardSession: () => undefined },
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: { registerView: () => () => {} },
    settingsSink,
    inputActions: { registerAction: () => () => {} },
    cardPanels: { registerSection: () => () => {} },
  }
}

// Ported structural gate: the manifest travels through the contract validator
// and declares exactly the surface the organ-porting checklist records
// (settings.section only; storage/ui/platform are implicit).
describe('update-checker · manifest (R-03, ported from RP 4fedffd)', () => {
  it('validates through the contract and declares the ported surface', () => {
    const result = validateManifest(UpdateCheckerPlugin.manifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('update-checker')
    expect(result.manifest.activation).toBe('lazy')
    expect(result.manifest.permissions).toEqual(['settings.section'])
    expect(result.manifest.extensionPoints?.settings).toEqual([
      { id: 'update-checker', title: '关于与更新' },
    ])
  })
})

describe('update-checker · compareVersions (ported logic + MP pre-release tolerance)', () => {
  it('compares numeric segments the RP way', () => {
    expect(compareVersions('2.63', '2.62')).toBe(1)
    expect(compareVersions('2.62', '2.63')).toBe(-1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })

  it('tolerates pre-release segments so MP versionName compares sanely', () => {
    expect(compareVersions('1.0.1', '1.0.0-alpha')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha')).toBe(0)
    expect(compareVersions('1.0.0-alpha', '0.9.0')).toBe(1)
  })
})

describe('update-checker · checkForUpdate (ported behavior)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces the release body for display and flags newer versions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ tag_name: 'v1.0.1', html_url: 'https://example.com/r', body: '修复与改进' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkForUpdate('1.0.0-alpha')
    expect(result.hasUpdate).toBe(true)
    expect(result.error).toBeNull()
    // The latest release body (GitHub release notes) must reach the card —
    // ported gate from the RP contract test.
    expect(result.release?.body).toBe('修复与改进')
    expect(result.release?.tag_name).toBe('v1.0.1')
  })

  it('reports no update when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await checkForUpdate('1.0.0-alpha')
    expect(result.hasUpdate).toBe(false)
    expect(result.release).toBeNull()
    expect(result.error).toBe('Unable to fetch release info')
  })

  it('reports no update for a same-version release', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ tag_name: 'v1.0.0-alpha', body: '' }),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const result = await checkForUpdate('1.0.0-alpha')
    expect(result.hasUpdate).toBe(false)
  })
})

describe('update-checker · download and install (ported guards)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fakeResponse(chunks: Uint8Array[], contentLength: number): Response {
    const reader = {
      index: 0,
      async read() {
        if (this.index >= chunks.length) return { done: true, value: undefined }
        return { done: false, value: chunks[this.index++]! }
      },
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(contentLength) : null) },
      body: { getReader: () => reader },
    } as unknown as Response
  }

  it('aborts when the server response is below the APK size floor', async () => {
    const releaseResponse = new Response(JSON.stringify({ tag_name: 'v1.0.1', body: '' }), { status: 200 })
    const fetchMock = vi.fn().mockResolvedValueOnce(releaseResponse).mockResolvedValueOnce(
      fakeResponse([new Uint8Array(1024)], 1024),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadApk()
    expect(result.data).toBeNull()
    expect(result.error).toContain('too small')
  })

  it('returns the APK bytes and tag on a complete download', async () => {
    const payload = new Uint8Array(5 * 1024 * 1024 + 1)
    const releaseResponse = new Response(JSON.stringify({ tag_name: 'v1.0.1', body: '' }), { status: 200 })
    const fetchMock = vi.fn().mockResolvedValueOnce(releaseResponse).mockResolvedValueOnce(
      fakeResponse([payload], payload.length),
    )
    vi.stubGlobal('fetch', fetchMock)

    const progress: number[] = []
    const result = await downloadApk((fraction) => progress.push(fraction))
    expect(result.error).toBeNull()
    expect(result.tag).toBe('1.0.1')
    expect(result.data?.length).toBe(payload.length)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('reports missing native channels instead of throwing (MP shell has none yet)', async () => {
    const result = await saveAndInstallApk(new Uint8Array(8), '1.0.1')
    expect(result.error).toBe('Required plugins not available')
  })
})

describe('update-checker · full lifecycle through the runtime (walking skeleton)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubSilentFetch(): void {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  }

  it('load → activate → register → deactivate → unload revokes everything for real', async () => {
    stubSilentFetch()
    const services = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(UpdateCheckerPlugin)

    // Activation: the settings section joins the kernel settings registry.
    await runtime.activate('update-checker')
    expect(runtime.isActive('update-checker')).toBe(true)
    expect(getRegisteredSettingsSections().map((section) => section.id)).toContain('update-checker:update-checker')

    // The 5s silent auto-check fires while active (ported startup behavior).
    const fetchMock = vi.mocked(globalThis.fetch)
    await vi.advanceTimersByTimeAsync(5100)
    expect(fetchMock).toHaveBeenCalled()

    // Deactivation: section gone, service instance gone, timers cancelled —
    // nothing survives the bag drain.
    await runtime.deactivate('update-checker')
    expect(runtime.isActive('update-checker')).toBe(false)
    expect(getRegisteredSettingsSections().some((section) => section.id === 'update-checker:update-checker')).toBe(false)
    expect(getActiveService()).toBeNull()

    const callsAfterDeactivate = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsAfterDeactivate)

    // unload ≡ deactivate (R-04): the plugin stays registered but off.
    await runtime.activate('update-checker')
    await runtime.unload('update-checker')
    expect(runtime.stateOf('update-checker')).toBe('registered')
  })

  it('per-day dismiss persists in the plugin namespace (plug:<id>: prefix)', async () => {
    stubSilentFetch()
    const services = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(UpdateCheckerPlugin)
    await runtime.activate('update-checker')

    const service = getActiveService()
    expect(service).not.toBeNull()
    service!.dismissUpdateNoticeToday()
    await vi.advanceTimersByTimeAsync(1)

    expect(service!.updateNoticeDismissedToday.value).toBe(true)
    const stored = await services.storage.get<string>(`plug:update-checker:${'update_notice_dismiss_date'}`)
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await runtime.deactivate('update-checker')
  })

  it('the section component renders the version footer while active', async () => {
    stubSilentFetch()
    const services = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(UpdateCheckerPlugin)
    await runtime.activate('update-checker')
    await vi.advanceTimersByTimeAsync(1)

    const wrapper = mount(UpdateCheckerSection)
    expect(wrapper.text()).toContain('MintPlot')
    expect(wrapper.text()).toContain(`v${MP_VERSION_NAME}`)
    expect(wrapper.text()).toContain('dev')

    await runtime.deactivate('update-checker')
    const wrapperAfter = mount(UpdateCheckerSection)
    expect(wrapperAfter.text()).toContain('更新检查服务未激活')
  })
})
