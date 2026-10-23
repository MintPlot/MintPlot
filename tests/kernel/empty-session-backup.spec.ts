import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createBackupService } from '@/kernel/dataio/backup-service'

afterEach(() => vi.unstubAllGlobals())

describe('empty session backup compatibility', () => {
  it('exports explicit empty chat keys and restores empty and populated sessions', async () => {
    const engine = createMemoryEngine()
    const repository = createStorageRepository(engine)
    const card = createCardSessionStore(repository)
    const chats = createChatboxStore(repository)
    await card.create({ id: 'empty-card', name: 'Synthetic', firstMes: '' })
    const empty = await chats.create('Synthetic empty')
    const filled = await chats.create('Synthetic filled')
    filled.messages.push({ id: 'm', role: 'user', content: 'Synthetic content', ts: 1 })
    await chats.save(filled)
    expect(await engine.get('chat:card:empty-card')).toBe('[]')
    expect(await engine.get(`chat:chatbox:${empty.id}`)).toBe('[]')
    let archive!: Uint8Array
    const fileBridge = () => ({
      exportFile: async (_name: string, _mime: string, bytes: Uint8Array) => { archive = bytes; return true },
      importFile: async () => archive,
    })
    const source = createBackupService({ engine, fileBridge })
    await source.exportBackup()
    const envelope = await source.readBackupFile()
    expect(envelope.kv['chat:card:empty-card']).toBe('[]')
    const restoredEngine = createMemoryEngine()
    const reload = vi.fn()
    vi.stubGlobal('window', { localStorage, location: { reload } })
    await createBackupService({ engine: restoredEngine, fileBridge }).restoreBackup(envelope)
    const restored = createStorageRepository(restoredEngine)
    expect((await createCardSessionStore(restored).get('empty-card'))!.messages).toEqual([])
    expect((await createChatboxStore(restored).get(empty.id))!.messages).toEqual([])
    expect((await createChatboxStore(restored).get(filled.id))!.messages).toEqual(filled.messages)
    expect(reload).toHaveBeenCalledOnce()
    // Backups produced by the previous optimization can omit an empty body.
    delete envelope.kv[`chat:chatbox:${empty.id}`]
    await createBackupService({ engine: restoredEngine, fileBridge }).restoreBackup(envelope)
    expect((await createChatboxStore(restored).get(empty.id))!.messages).toEqual([])
  })
})
