import { beforeEach, describe, expect, it } from 'vitest'
import { createNstyleStore, getTempOverride, setTempOverride } from '../../src/kernel/nstyle/nstyle-store'
import { DEFAULT_STORY_CONFIG } from '../../src/kernel/nstyle/types'
import type { NstyleConfig, NstyleProfile } from '../../src/kernel/nstyle/types'
import { createStorageRepository } from '../../src/kernel/store/storage-repository'
import { createMemoryEngine } from '../../src/kernel/store/kv-store'

const makeStore = () => createNstyleStore(createStorageRepository(createMemoryEngine()))

const profile = (id: string, name: string, config?: Partial<NstyleConfig>): NstyleProfile => ({
  id,
  name,
  description: '',
  config: { ...DEFAULT_STORY_CONFIG, ...(config ?? {}) },
  builtin: false,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
})

describe('叙事风格存储(M4-nstyle)', () => {
  beforeEach(() => {
    setTempOverride(null)
  })

  it('自定义风格 CRUD:保存/更新/删除互不影响', async () => {
    const store = makeStore()
    const saved = await store.saveCustom(profile('a', '风格A'))
    expect(saved.id).toBe('a')
    expect(saved.updatedAt).toBeGreaterThan(0)
    await store.saveCustom(profile('b', '风格B'))
    expect(store.listCustomsSync().map((p) => p.name)).toEqual(['风格A', '风格B'])

    await store.saveCustom(profile('a', '风格A改'))
    expect(store.listCustomsSync().map((p) => p.name)).toEqual(['风格A改', '风格B'])

    await store.deleteCustom('a')
    expect(store.listCustomsSync().map((p) => p.name)).toEqual(['风格B'])
  })

  it('同步镜像在异步落盘前即可读(请求路径零 await)', async () => {
    const store = makeStore()
    await store.setGlobal({ ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, dialogue: 90 } })
    expect(store.getGlobalSync()?.params.dialogue).toBe(90)
    await store.setCardOverride('card-1', { ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, pacing: 20 } })
    expect(store.getCardOverrideSync('card-1')?.params.pacing).toBe(20)
    expect(store.getCardOverrideSync('card-2')).toBeNull()
  })

  it('清除故事级覆盖(null)回落全局', async () => {
    const store = makeStore()
    await store.setGlobal({ ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, dialogue: 10 } })
    await store.setCardOverride('card-1', { ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, dialogue: 90 } })
    await store.setCardOverride('card-1', null)
    expect(store.getCardOverrideSync('card-1')).toBeNull()
    expect(store.getGlobalSync()?.params.dialogue).toBe(10)
  })

  it('刷新后从持久层恢复(镜像水合)', async () => {
    const repo = createStorageRepository(createMemoryEngine())
    const first = createNstyleStore(repo)
    await first.saveCustom(profile('persist', '持久化风格'))
    await first.setGlobal({ ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, emotion: 95 } })

    // 新实例 = 模拟「重新打开应用」:从同一持久层水合
    const second = createNstyleStore(repo)
    await second.hydrated
    expect(second.listCustomsSync().map((p) => p.name)).toEqual(['持久化风格'])
    expect(second.getGlobalSync()?.params.emotion).toBe(95)
  })

  it('脏数据静默降级:损坏的自定义条目被跳过,不崩溃', async () => {
    const repo = createStorageRepository(createMemoryEngine())
    await repo.set('nstyle:customs', [{ id: 'ok', name: '有效', version: 1, config: {} }, { broken: true }, 'junk'])
    const store = createNstyleStore(repo)
    await store.hydrated
    expect(store.listCustomsSync().map((p) => p.name)).toEqual(['有效'])
  })

  it('会话临时配置:内存读写,不落盘', async () => {
    const repo = createStorageRepository(createMemoryEngine())
    const store = createNstyleStore(repo)
    await store.hydrated
    setTempOverride({ ...DEFAULT_STORY_CONFIG, params: { ...DEFAULT_STORY_CONFIG.params, subtext: 90 } })
    expect(getTempOverride()?.params.subtext).toBe(90)
    // 临时配置不产生任何持久化键
    expect(await repo.get('nstyle:global')).toBeUndefined()
    expect(await repo.get('nstyle:customs')).toBeUndefined()
    setTempOverride(null)
    expect(getTempOverride()).toBeNull()
  })
})
