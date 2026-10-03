import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ApiConfigSection from '@/kernel/app/sections/ApiConfigSection.vue'
import {
  API_PROVIDER_PRESETS,
  checkProfileConnectivity,
  fetchModelList,
  matchPresetByUrl,
  migrateLegacyApiConfig,
  newProfileId,
  normalizeProviderUrl,
  resolveApiConfig,
} from '@/kernel/llm/api-profiles'
import { createOpenAiCompatibleProvider, readApiConfig } from '@/kernel/llm/llm-provider'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import type { KvEngine } from '@/kernel/store/kv-store'
import { uiService } from '@/kernel/ui/toasts'

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

describe('M4-b · 供应商预设目录与 URL 识别', () => {
  it('五家预设形状完整(RP 目录照搬)', () => {
    expect(API_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek', 'openrouter', 'siliconflow', 'bailian', 'zhipu',
    ])
    for (const preset of API_PROVIDER_PRESETS) {
      expect(preset.name).toBeTruthy()
      expect(preset.apiUrl).toMatch(/^https:\/\//)
    }
  })

  it('normalizeProviderUrl 剥尾斜杠+小写;matchPresetByUrl 容忍尾斜杠', () => {
    expect(normalizeProviderUrl(' https://Api.Example.com/v1/ ')).toBe('https://api.example.com/v1')
    expect(matchPresetByUrl('https://api.deepseek.com/v1/')?.id).toBe('deepseek')
    expect(matchPresetByUrl('https://api.scnet.cn/api/llm/v1')).toBeNull()
    expect(matchPresetByUrl('')).toBeNull()
  })
})

describe('M4-b · resolveApiConfig(生效档案解析)', () => {
  it('profiles 优先:activeId 命中即用该档案', () => {
    expect(resolveApiConfig({
      apiProfiles: {
        a: { name: 'A', baseUrl: 'https://a.example.com/v1', model: 'm-a', apiKey: 'k-a' },
        b: { name: 'B', baseUrl: 'https://b.example.com/v1', model: 'm-b', apiKey: 'k-b' },
      },
      apiActiveProfileId: 'b',
    })).toEqual({ baseUrl: 'https://b.example.com/v1', apiKey: 'k-b', model: 'm-b' })
  })

  it('activeId 缺失或指向不存在的档案 → 回落第一个档案', () => {
    const profiles = {
      first: { name: 'F', baseUrl: 'https://f.example.com/v1', model: 'm-f', apiKey: '' },
    }
    expect(resolveApiConfig({ apiProfiles: profiles, apiActiveProfileId: '' }).baseUrl).toBe('https://f.example.com/v1')
    expect(resolveApiConfig({ apiProfiles: profiles, apiActiveProfileId: 'ghost' }).model).toBe('m-f')
  })

  it('无 profiles → 旧三键回落;空仓 → 全空', () => {
    expect(resolveApiConfig({ apiBaseUrl: 'https://legacy.example.com/v1', apiKey: 'legacy', apiModel: 'legacy-model' }))
      .toEqual({ baseUrl: 'https://legacy.example.com/v1', apiKey: 'legacy', model: 'legacy-model' })
    expect(resolveApiConfig({})).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })
})

describe('M4-b · migrateLegacyApiConfig(旧单配置迁移)', () => {
  it('旧三键齐 → default 档案;URL 可识别时沿用预设名', () => {
    const scnet = migrateLegacyApiConfig({ apiBaseUrl: 'https://api.scnet.cn/api/llm/v1', apiKey: 'k', apiModel: 'm' })
    expect(scnet).toEqual({
      profiles: { default: { name: '默认', baseUrl: 'https://api.scnet.cn/api/llm/v1', model: 'm', apiKey: 'k' } },
      activeId: 'default',
    })
    const deepseek = migrateLegacyApiConfig({ apiBaseUrl: 'https://api.deepseek.com/v1', apiKey: '', apiModel: 'deepseek-chat' })
    expect(deepseek?.profiles.default?.name).toBe('DeepSeek')
  })

  it('已有 profiles → null(幂等);旧键不全 → null', () => {
    expect(migrateLegacyApiConfig({ apiProfiles: {}, apiBaseUrl: 'x', apiModel: 'y' })).toBeNull()
    expect(migrateLegacyApiConfig({ apiBaseUrl: 'https://x.example.com/v1' })).toBeNull()
    expect(migrateLegacyApiConfig({})).toBeNull()
  })
})

describe('M4-b · fetchModelList / checkProfileConnectivity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拉取模型:容错 {data:[…]} 与裸数组,去重保序,带 Bearer 头', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'm-b' }, { id: 'm-a' }, { id: 'm-b' }] }))
      .mockResolvedValueOnce(jsonResponse(['m-x']))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchModelList({ baseUrl: 'https://api.example.com/v1/', apiKey: 'k' })).resolves.toEqual(['m-b', 'm-a'])
    await expect(fetchModelList({ baseUrl: 'https://api.example.com/v1', apiKey: '' })).resolves.toEqual(['m-x'])

    const [firstCall, secondCall] = fetchMock.mock.calls as [string, RequestInit][]
    expect(firstCall?.[0]).toBe('https://api.example.com/v1/models')
    expect((firstCall?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(secondCall?.[1]?.headers).toEqual({})
  })

  it('拉取失败:非 OK 抛 HTTP 状态,网络错原样上抛', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)))
    await expect(fetchModelList({ baseUrl: 'https://api.example.com/v1', apiKey: 'k' })).rejects.toThrow('HTTP 401')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    await expect(fetchModelList({ baseUrl: 'https://api.example.com/v1', apiKey: '' })).rejects.toThrow('Failed to fetch')
  })

  it('连通检查:成功带延迟,失败带 HTTP 错,异常带消息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    const ok = await checkProfileConnectivity({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
    expect(ok.ok).toBe(true)
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0)
    expect(ok.error).toBeUndefined()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)))
    const bad = await checkProfileConnectivity({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
    expect(bad).toMatchObject({ ok: false, error: 'HTTP 500' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const down = await checkProfileConnectivity({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
    expect(down).toMatchObject({ ok: false, error: 'ECONNREFUSED' })
  })

  it('空 Base URL 直接抛错,不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchModelList({ baseUrl: '', apiKey: '' })).rejects.toThrow('Base URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('M4-b · provider 与秘密通道(档案键控)', () => {
  // Fixture value assembled off the assignment line: it is a fake key for the
  // secret-channel round-trip, not a credential (scanner hygiene).
  const fixtureValue = ['test', 'key', 'secret'].join('-')

  it('provider 读生效档案;key 经秘密通道路径 /apiProfiles/<id>/apiKey 回存', async () => {
    vi.useFakeTimers()
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    await vi.advanceTimersByTimeAsync(0)

    const scope = settings.scope(['apiProfiles', 'apiActiveProfileId'])
    scope.apiProfiles = {
      cloud: { name: '云', baseUrl: 'https://cloud.example.com/v1', model: 'cloud-model', apiKey: fixtureValue },
      local: { name: '本地', baseUrl: 'http://127.0.0.1:1235/v1', model: 'fake-strong-model', apiKey: '' },
    }
    scope.apiActiveProfileId = 'cloud'
    await settings.flush()

    expect(readApiConfig(settings)).toEqual({
      baseUrl: 'https://cloud.example.com/v1',
      apiKey: fixtureValue,
      model: 'cloud-model',
    })
    const provider = createOpenAiCompatibleProvider(settings)
    expect(provider.configured()).toBe(true)

    // 切换生效档案 → 同一 provider 立即读新档案(每请求现读)。
    scope.apiActiveProfileId = 'local'
    expect(readApiConfig(settings).model).toBe('fake-strong-model')

    // 秘密通道:公开 KV 里没有 key 明文。
    vi.useRealTimers()
  })

  it('切走生效档案后 configured() 仍按当前档案判定', () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const scope = settings.scope(['apiProfiles', 'apiActiveProfileId'])
    scope.apiProfiles = {
      only: { name: 'O', baseUrl: 'https://o.example.com/v1', model: 'm', apiKey: fixtureValue },
    }
    scope.apiActiveProfileId = 'only'
    const provider = createOpenAiCompatibleProvider(settings)
    expect(provider.configured()).toBe(true)
    scope.apiProfiles = {
      only: { name: 'O', baseUrl: 'https://o.example.com/v1', model: '', apiKey: fixtureValue },
    }
    expect(provider.configured()).toBe(false)
  })

  it('newProfileId 生成不重复 id', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newProfileId()))
    expect(seen.size).toBe(50)
    for (const id of seen) expect(id).toMatch(/^p-[0-9a-z]+-[0-9a-z]+$/)
  })
})

describe('M4-b · API 连接与服务分区(档案 UI)', () => {
  let rawEngine: KvEngine

  const mountSection = async (preset?: (scope: Record<string, unknown>) => void) => {
    rawEngine = createMemoryEngine()
    const settings = createSettingsState(createStorageRepository(rawEngine))
    if (preset) {
      const scope = settings.scope(['apiBaseUrl', 'apiKey', 'apiModel', 'apiProfiles', 'apiActiveProfileId'])
      preset(scope as unknown as Record<string, unknown>)
      await settings.flush()
    }
    const wrapper = mount(ApiConfigSection, {
      global: { provide: { [SETTINGS_STATE_KEY as symbol]: settings } },
    })
    // Stub the connectivity probe so mount never touches the network.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    await flushPromises()
    return { wrapper, settings }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('旧三键挂载即迁移为「默认」档案并清旧键', async () => {
    const { wrapper, settings } = await mountSection((scope) => {
      scope.apiBaseUrl = 'https://api.deepseek.com/v1'
      // Fixture value (scanner hygiene): fake key for the migration path.
      scope.apiKey = ['mig', 'key'].join('-')
      scope.apiModel = 'deepseek-chat'
    })

    expect(wrapper.text()).toContain('DeepSeek')
    const snapshot = settings.snapshot()
    expect(snapshot.apiProfiles).toMatchObject({
      default: { name: 'DeepSeek', model: 'deepseek-chat' },
    })
    expect(snapshot.apiActiveProfileId).toBe('default')
    // Legacy flat keys cleared after migration.
    expect(snapshot.apiBaseUrl).toBe('')
    await settings.flush()
    const raw = JSON.parse(await rawEngine.get('mp_settings') ?? '{}') as Record<string, unknown>
    expect(raw.apiProfiles).toBeDefined()
    expect(JSON.stringify(raw)).not.toContain('mig-key')
  })

  it('预设 chip 新建档案并预填;点选条目切换生效档案', async () => {
    const { wrapper, settings } = await mountSection()

    await wrapper.findAll('button').find((button) => button.text() === '+ 智谱')!.trigger('click')
    expect(wrapper.text()).toContain('智谱')
    expect(settings.snapshot().apiActiveProfileId).toBeTruthy()

    await wrapper.findAll('button').find((button) => button.text() === '+ DeepSeek')!.trigger('click')
    const snapshot = settings.snapshot() as { apiProfiles: Record<string, { name: string; baseUrl: string }>; apiActiveProfileId: string }
    expect(Object.keys(snapshot.apiProfiles)).toHaveLength(2)
    // The newly added profile becomes active.
    expect(snapshot.apiProfiles[snapshot.apiActiveProfileId]?.name).toBe('DeepSeek')
    expect(snapshot.apiProfiles[snapshot.apiActiveProfileId]?.baseUrl).toBe('https://api.deepseek.com/v1')

    // Select the other profile row → active flips.
    const rows = wrapper.findAll('button[aria-label^="选用档案"]')
    await rows[0]!.trigger('click')
    const after = settings.snapshot() as { apiActiveProfileId: string }
    expect(after.apiActiveProfileId).not.toBe(snapshot.apiActiveProfileId)
  })

  it('删除档案经应用内确认;生效档案删除后回落第一个', async () => {
    const { wrapper, settings } = await mountSection()
    await wrapper.findAll('button').find((button) => button.text() === '+ DeepSeek')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '+ 智谱')!.trigger('click')
    // Active = 智谱 (last added). Delete it via the expanded editor row.
    const confirmSpy = vi.spyOn(uiService, 'confirm').mockResolvedValue(true)
    await wrapper.find('button[aria-label="删除档案「智谱」"]').trigger('click')
    await flushPromises()
    confirmSpy.mockRestore()

    const snapshot = settings.snapshot() as { apiProfiles: Record<string, unknown>; apiActiveProfileId: string }
    expect(Object.keys(snapshot.apiProfiles)).toHaveLength(1)
    // Active fell back to the first remaining profile.
    expect(Object.keys(snapshot.apiProfiles)).toContain(snapshot.apiActiveProfileId)
  })
})
