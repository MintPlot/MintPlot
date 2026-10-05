import { describe, expect, it } from 'vitest'
import {
  buildMemoryContext,
  computePendingBatch,
  createEmptyMemoryState,
  pruneFloorsForMemory,
  sanitizeMemoryProfile,
  sanitizeMemoryState,
} from '@/kernel/memory/memory-engine'
import type { MemoryState } from '@/kernel/memory/memory-engine'
import { createMemoryStore } from '@/kernel/memory/memory-store'
import { MEMORY_SUMMARY_SYSTEM_PROMPT } from '@/kernel/memory/prompts'
import {
  MEMORY_ANCHOR_LIMIT,
  parseSummaryReply,
  readMemorySummarySettings,
  runRollingSummary,
} from '@/kernel/memory/summary-pipeline'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createMemorySettingsState } from '../helpers/memory-settings'
import manifest from '@/plugins/memory/manifest.json'
import MemoryPlugin from '@/plugins/memory'

const stateWith = (patch: Partial<MemoryState>): MemoryState => ({ ...createEmptyMemoryState(), ...patch })

describe('memory engine (M4-e)', () => {
  it('computePendingBatch: window = total − keep, clamped by batchSize, null when current', () => {
    expect(computePendingBatch(20, 16, 8, stateWith({ anchor: 0 }))).toEqual({ from: 0, to: 4 })
    expect(computePendingBatch(30, 16, 8, stateWith({ anchor: 0 }))).toEqual({ from: 0, to: 8 })
    expect(computePendingBatch(30, 16, 8, stateWith({ anchor: 8 }))).toEqual({ from: 8, to: 14 })
    // Window inside the anchor (or below keepFloors) → nothing pending.
    expect(computePendingBatch(30, 16, 8, stateWith({ anchor: 14 }))).toBeNull()
    expect(computePendingBatch(10, 16, 8, stateWith({ anchor: 0 }))).toBeNull()
  })

  it('pruneFloorsForMemory: keeps the trailing window, no-op below it', () => {
    const floors = ['a', 'b', 'c', 'd', 'e']
    expect(pruneFloorsForMemory(floors, 2)).toEqual(['d', 'e'])
    expect(pruneFloorsForMemory(floors, 8)).toBe(floors)
    expect(pruneFloorsForMemory(floors, 0)).toBe(floors)
  })

  it('buildMemoryContext: empty state renders nothing; full state renders the RP block shape', () => {
    expect(buildMemoryContext(createEmptyMemoryState())).toBe('')
    const state = stateWith({
      short: '近期剧情',
      long: '长期脉络',
      profile: {
        characters: [{ name: '星澜', status: '闭关' }],
        relations: [{ from: '星澜', to: '旅人', relation: '同门' }],
        openPlots: [{ summary: '寻找古琴', status: 'open', deadline: '月末' }],
      },
    })
    const block = buildMemoryContext(state)
    expect(block).toContain('<role_memory>')
    expect(block).toContain('<long_summary>')
    expect(block).toContain('长期脉络')
    expect(block).toContain('<short_summary>')
    expect(block).toContain('近期剧情')
    expect(block).toContain('<character_status>')
    expect(block).toContain('星澜：闭关')
    expect(block).toContain('星澜 → 旅人：同门')
    expect(block).toContain('- 寻找古琴（月末）')
    expect(block).toContain('不是正文，不要复述')
    expect(block.endsWith('</role_memory>')).toBe(true)
  })

  it('sanitizeMemoryState / sanitizeMemoryProfile: garbage degrades to defaults, valid rows survive', () => {
    expect(sanitizeMemoryState(null)).toEqual(createEmptyMemoryState())
    expect(sanitizeMemoryState({ short: 42, anchor: 'x', batches: 'no' })).toEqual(createEmptyMemoryState())
    const profile = sanitizeMemoryProfile({
      characters: [{ name: ' 星澜 ', status: '闭关' }, { status: 'no-name' }, 'junk'],
      relations: [{ from: 'a', to: 'b', relation: 'r' }, { from: 'a' }],
      openPlots: [{ summary: '寻琴' }, { deadline: 'no-summary' }],
    })
    expect(profile.characters).toEqual([{ name: '星澜', status: '闭关' }])
    expect(profile.relations).toEqual([{ from: 'a', to: 'b', relation: 'r' }])
    expect(profile.openPlots).toEqual([{ summary: '寻琴' }])
    const state = sanitizeMemoryState({ short: 's', long: 'l', profile, batches: [{ from: 0, to: 4, status: 'done' }, { junk: 1 }], anchor: 6.7, updatedAt: 9 })
    expect(state.short).toBe('s')
    expect(state.anchor).toBe(7)
    expect(state.batches).toHaveLength(1)
  })
})

describe('memory store (M4-e)', () => {
  it('save/get roundtrip per scope; reset drops the reserved key; scopes never mix', async () => {
    const store = createMemoryStore(createStorageRepository(createMemoryEngine()))
    const a = { kind: 'card' as const, id: 'card-a' }
    const b = { kind: 'card' as const, id: 'card-b' }
    expect(await store.get(a)).toBeNull()
    await store.save(a, stateWith({ short: 'A 的记忆', anchor: 4 }))
    await store.save(b, stateWith({ short: 'B 的记忆', anchor: 2 }))
    expect((await store.get(a))?.short).toBe('A 的记忆')
    expect((await store.get(b))?.short).toBe('B 的记忆')
    await store.reset(a)
    expect(await store.get(a)).toBeNull()
    expect((await store.get(b))?.short).toBe('B 的记忆')
    // ensure is read-or-fresh and does not persist the empty state.
    expect(await store.ensure(a)).toEqual(createEmptyMemoryState())
    expect(await store.get(a)).toBeNull()
  })
})

describe('memory summary settings (M4-e)', () => {
  it('defaults on null settings; live keys clamp into range', async () => {
    expect(readMemorySummarySettings(null)).toEqual({ model: '', keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 })
    const settingsState = createMemorySettingsState()
    const scope = settingsState.scope(['memoryModel', 'memoryKeepFloors', 'memoryBatchSize', 'memoryMaxOutputTokens'])
    scope.memoryModel = 'sum-model'
    scope.memoryKeepFloors = 99
    scope.memoryBatchSize = 1
    scope.memoryMaxOutputTokens = 999999
    expect(readMemorySummarySettings(settingsState)).toEqual({ model: 'sum-model', keepFloors: 40, batchSize: 4, maxOutputTokens: 8192 })
  })
})

describe('parseSummaryReply (M4-e)', () => {
  const previous = stateWith({ short: '旧短', long: '旧长', profile: { characters: [{ name: '星澜', status: '旧状态' }], relations: [], openPlots: [] } })

  it('parses direct JSON, fills missing fields from previous, drops junk profile rows', () => {
    const picked = parseSummaryReply(
      '{"short":"新短","profile":{"characters":[{"name":"旅人","status":"受伤"},{"nonsense":1}],"relations":[]}}',
      previous,
    )
    expect(picked.short).toBe('新短')
    expect(picked.long).toBe('旧长')
    expect(picked.profile.characters).toEqual([{ name: '旅人', status: '受伤' }])
    expect(picked.profile.relations).toEqual([])
    expect(picked.profile.openPlots).toEqual(previous.profile.openPlots)
  })

  it('tolerates fences and prose around the JSON span', () => {
    const fenced = parseSummaryReply('```json\n{"short":"围栏短"}\n```', previous)
    expect(fenced.short).toBe('围栏短')
    const wrapped = parseSummaryReply('好的，以下是整理结果：\n{"short":"包裹短","long":"包裹长"}\n请查收。', previous)
    expect(wrapped.short).toBe('包裹短')
    expect(wrapped.long).toBe('包裹长')
  })

  it('downgrades plain prose to the short summary; empty reply throws', () => {
    const downgraded = parseSummaryReply('旅人继续赶路，星澜闭关未归。', previous)
    expect(downgraded.short).toBe('旅人继续赶路，星澜闭关未归。')
    expect(downgraded.long).toBe('旧长')
    expect(() => parseSummaryReply('   ', previous)).toThrow()
  })
})

describe('runRollingSummary (M4-e)', () => {
  const FLOORS = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    name: index % 2 === 0 ? '旅人' : '星澜',
    content: `楼 ${index}`,
  }))

  it('one batch: system protocol + previous payload + turns ride the request; usage tagged', async () => {
    const calls: Array<{ messages: readonly unknown[]; model: string }> = []
    const usages: Array<{ detail: string; model: string; type: string }> = []
    const result = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'sum-model' },
      floors: FLOORS,
      state: createEmptyMemoryState(),
      settings: { keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 },
      complete: async (config, messages) => {
        calls.push({ messages, model: config.model })
        return { content: '{"short":"新短","long":"新长","profile":{"characters":[{"name":"星澜","status":"闭关"}]}}', usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12, cacheReadTokens: null }, model: 'sum-model' }
      },
      onUsage: (usage, meta) => {
        expect(usage).toMatchObject({ inputTokens: 9 })
        usages.push(meta)
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('sum-model')
    const system = (calls[0]!.messages as Array<{ role: string; content: string }>)[0]!
    expect(system.role).toBe('system')
    expect(system.content).toBe(MEMORY_SUMMARY_SYSTEM_PROMPT)
    expect(system.content).toContain('严格返回JSON')
    const user = JSON.parse((calls[0]!.messages as Array<{ role: string; content: string }>)[1]!.content) as {
      previous: { short: string }
      turns: Array<{ content: string }>
    }
    expect(user.previous.short).toBe('')
    expect(user.turns).toHaveLength(4)
    expect(user.turns[0]).toMatchObject({ role: 'user', content: '楼 0' })
    expect(result.state.anchor).toBe(4)
    expect(result.state.short).toBe('新短')
    expect(result.state.batches[0]).toMatchObject({ from: 0, to: 4, status: 'done' })
    expect(result.batches).toBe(1)
    expect(result.error).toBe('')
    expect(usages).toEqual([{ type: 'summary', model: 'sum-model', detail: '滚动摘要 1–4 楼' }])
  })

  it('loops sequential batches until the window is covered', async () => {
    const ranges: Array<[number, number]> = []
    const result = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      floors: FLOORS,
      state: createEmptyMemoryState(),
      settings: { keepFloors: 2, batchSize: 2, maxOutputTokens: 1024 },
      complete: async (_config, messages) => {
        const payload = JSON.parse((messages as readonly { content: string }[])[1]!.content) as { turns: unknown[] }
        void payload
        const state = ranges.length
        ranges.push([state * 2, state * 2 + 2])
        return { content: `{"short":"第 ${ranges.length} 批"}`, usage: null, model: 'm' }
      },
    })
    // Window = 20 − 2 = 18 → batches (0,2)(2,4)…(16,18): nine requests.
    expect(ranges).toHaveLength(9)
    expect(ranges[0]).toEqual([0, 2])
    expect(ranges[8]).toEqual([16, 18])
    expect(result.state.anchor).toBe(18)
    expect(result.batches).toBe(9)
    expect(result.state.short).toBe('第 9 批')
  })

  it('a failed batch parks the anchor and the next run retries the SAME range first', async () => {
    let attempt = 0
    const seenRanges: Array<[number, number]> = []
    const first = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      floors: FLOORS,
      state: createEmptyMemoryState(),
      settings: { keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 },
      complete: async () => {
        attempt += 1
        throw Object.assign(new Error('HTTP 400: refuse'), { status: 400 })
      },
    })
    expect(first.error).toContain('refuse')
    expect(first.state.anchor).toBe(0)
    expect(first.state.batches).toEqual([expect.objectContaining({ from: 0, to: 4, status: 'failed' })])
    expect(attempt).toBe(1)

    const second = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      floors: FLOORS,
      state: first.state,
      settings: { keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 },
      complete: async (_config, messages) => {
        const payload = JSON.parse((messages as readonly { content: string }[])[1]!.content) as { turns: unknown[] }
        seenRanges.push([payload.turns.length, 0])
        return { content: '{"short":"补上了"}', usage: null, model: 'm' }
      },
    })
    expect(second.error).toBe('')
    expect(second.state.anchor).toBe(4)
    expect(second.state.short).toBe('补上了')
    expect(second.state.batches.filter((batch) => batch.status === 'done')).toHaveLength(1)
    void seenRanges
  })

  it('aborts cleanly (no failed-batch record) and the breaker stops long chains', async () => {
    const controller = new AbortController()
    controller.abort()
    const aborted = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      floors: FLOORS,
      state: createEmptyMemoryState(),
      settings: { keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 },
      signal: controller.signal,
      complete: async () => {
        throw new Error('should not be called')
      },
    })
    expect(aborted.batches).toBe(0)
    expect(aborted.error).toBe('')
    expect(aborted.state.batches).toHaveLength(0)

    const breaker = await runRollingSummary({
      config: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      floors: FLOORS,
      state: stateWith({ anchor: MEMORY_ANCHOR_LIMIT }),
      settings: { keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 },
      complete: async () => {
        throw new Error('should not be called')
      },
    })
    expect(breaker.batches).toBe(0)
    expect(breaker.error).toContain('上限')
  })
})

describe('memory plugin surface (M4-e)', () => {
  it('manifest declares the card-domain toggle; the entry is the serviceless shell', () => {
    expect(manifest.id).toBe('memory')
    expect(manifest.sessions).toEqual(['card'])
    expect(manifest.permissions).toEqual([])
    expect(manifest.display.name).toBe('记忆系统')
    expect(MemoryPlugin.manifest.id).toBe('memory')
    expect(typeof MemoryPlugin.activate).toBe('function')
  })
})
