import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_EXCLUDED_KEYS,
  BACKUP_FORMAT,
  BackupEnvelopeError,
  createBackupEnvelope,
  isExcludedFromBackup,
  parseBackupEnvelope,
  serializeBackupEnvelope,
} from '@/kernel/dataio/backup-envelope'
import { createBackupService } from '@/kernel/dataio/backup-service'
import type { KvEngine } from '@/kernel/store/kv-store'

const makeEngine = (initial: Record<string, string> = {}): KvEngine & { dump: () => Record<string, string> } => {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    async get(key) {
      return store.get(key) ?? null
    },
    async set(key, json) {
      store.set(key, json)
    },
    async remove(key) {
      store.delete(key)
    },
    async keys() {
      return [...store.keys()]
    },
    dump() {
      return Object.fromEntries(store)
    },
  }
}

describe('kernel/dataio · backup envelope (M4-g1)', () => {
  it('carries the format marker, version and verbatim kv values', () => {
    const envelope = createBackupEnvelope({ 'chat:card:x': '{"a":1}', mp_settings: '{"k":2}' }, { mp_theme_pref: 'light' }, '1.0.0')
    expect(envelope.format).toBe(BACKUP_FORMAT)
    expect(envelope.formatVersion).toBe(1)
    expect(envelope.appVersion).toBe('1.0.0')
    expect(envelope.kv['chat:card:x']).toBe('{"a":1}')
    const parsed = parseBackupEnvelope(serializeBackupEnvelope(envelope))
    expect(parsed).toEqual(envelope)
  })

  it('the error journal is excluded from backup scope', () => {
    expect(isExcludedFromBackup('error-journal')).toBe(true)
    expect(isExcludedFromBackup('chat:card:x')).toBe(false)
    expect(BACKUP_EXCLUDED_KEYS).toEqual(['error-journal'])
  })

  it('parse rejects foreign and malformed files with readable errors', () => {
    expect(() => parseBackupEnvelope('not json')).toThrow(BackupEnvelopeError)
    expect(() => parseBackupEnvelope('{"format":"other-app-backup","formatVersion":1}')).toThrow('不是 MintPlot 备份文件')
    expect(() => parseBackupEnvelope(`{"format":"${BACKUP_FORMAT}","formatVersion":99,"kv":{}}`)).toThrow('更新版本')
    expect(() => parseBackupEnvelope(`{"format":"${BACKUP_FORMAT}","formatVersion":1}`)).toThrow('缺少存储数据')
  })
})

describe('kernel/dataio · backup service (M4-g1)', () => {
  let fileRef: { bytes: Uint8Array; name: string } | null = null

  beforeEach(() => {
    fileRef = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeFileBridge = () => ({
    async exportFile(fileName: string, _mimeType: string, bytes: Uint8Array) {
      fileRef = { bytes, name: fileName }
      return true
    },
    async importFile() {
      return fileRef ? fileRef.bytes : null
    },
  })

  it('export enumerates storage, drops the journal, names the file with a timestamp', async () => {
    const engine = makeEngine({
      'chat:card:x': '{"floors":[]}',
      'character:index': '["x"]',
      'error-journal': '[]',
    })
    const service = createBackupService({ engine, fileBridge: makeFileBridge })
    await service.exportBackup()
    expect(fileRef).not.toBeNull()
    expect(fileRef!.name).toMatch(/^mintplot-\d+\.mintplot-backup\.json$/)
    const envelope = JSON.parse(new TextDecoder().decode(fileRef!.bytes))
    expect(envelope.kv['chat:card:x']).toBe('{"floors":[]}')
    expect(envelope.kv['error-journal']).toBeUndefined()
  })

  it('restore full-replaces: writes envelope keys, removes unknown keys, keeps the journal', async () => {
    const engine = makeEngine({
      'chat:card:x': '{"old":true}',
      'character:index': '["x"]',
      'error-journal': '[1]',
    })
    const service = createBackupService({ engine, fileBridge: makeFileBridge })
    await service.exportBackup()
    engine.set('stray:key', '[]') // appears after the export — must not survive restore
    const envelope = parseBackupEnvelope(new TextDecoder().decode(fileRef!.bytes))
    engine.set('chat:card:x', '{"changed":true}')
    await service.restoreBackup(envelope)
    const dump = engine.dump()
    expect(dump['chat:card:x']).toBe('{"old":true}')
    expect(dump['character:index']).toBe('["x"]')
    expect(dump['stray:key']).toBeUndefined()
    expect(dump['error-journal']).toBe('[1]')
  })

  it('describe summarizes the envelope for the confirm modal', async () => {
    const service = createBackupService({ engine: makeEngine(), fileBridge: makeFileBridge })
    const summary = service.describeBackup(createBackupEnvelope({ a: '1', b: '2' }, {}, '1.0.0'))
    expect(summary).toContain('2 项数据')
    expect(summary).toContain('应用 1.0.0')
  })
})
