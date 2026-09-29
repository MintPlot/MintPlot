import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createIdbEngine, createDefaultEngine, MP_IDB_NAME } from '@/kernel/store/idb-engine'
import { createKvStore, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'

// Each test gets a fresh IndexedDB factory (fake-indexeddb dev-only harness —
// the runtime engine touches raw IndexedDB, no idb/Dexie library).
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mp idb engine (ADR-003 R-01, bare IndexedDB)', () => {
  it('round-trips raw JSON strings and removes entries', async () => {
    const engine = createIdbEngine()
    await engine.set('mp_demo', '{"a":1}')
    expect(await engine.get('mp_demo')).toBe('{"a":1}')

    await engine.remove('mp_demo')
    expect(await engine.get('mp_demo')).toBeNull()
  })

  it('enumerates keys; data survives across engine instances (durability)', async () => {
    const writer = createIdbEngine()
    await writer.set('mp_a', '1')
    await writer.set('mp_b', '2')

    const reader = createIdbEngine()
    expect((await reader.keys()).sort()).toEqual(['mp_a', 'mp_b'])
    expect(await reader.get('mp_b')).toBe('2')
  })

  it('the default store ladder persists under the mp_ prefix', async () => {
    const store = createKvStore(createPrefixedEngine(createDefaultEngine(), MP_STORAGE_PREFIX))
    await store.set('plugin-states', { 'update-checker': true })
    expect(await store.get<Record<string, boolean>>('plugin-states')).toEqual({ 'update-checker': true })

    // At rest the raw engine sees the prefixed key only.
    const raw = createIdbEngine()
    expect(await raw.get(`${MP_STORAGE_PREFIX}plugin-states`)).toBe('{"update-checker":true}')
    expect((await raw.keys()).every((key) => key.startsWith(MP_STORAGE_PREFIX))).toBe(true)
  })

  it('degrades to localStorage for the session when IndexedDB fails to open', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('simulated idb outage')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = createDefaultEngine()

    await engine.set('mp_fallback', 'value')
    expect(await engine.get('mp_fallback')).toBe('value')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('degrading to localStorage'), expect.anything())

    // localStorage IS the degraded store — visible through the same engine.
    expect(localStorage.getItem('mp_fallback')).toBe('value')
    errorSpy.mockRestore()
  })

  it('uses localStorage outright when IndexedDB is absent (web-dev fallback)', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const engine = createDefaultEngine()
    await engine.set('mp_plain', 'v1')
    expect(await engine.get('mp_plain')).toBe('v1')
    expect(localStorage.getItem('mp_plain')).toBe('v1')
    void MP_IDB_NAME
  })
})
