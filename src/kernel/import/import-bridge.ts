/**
 * MpBackup bridge wrapper (M4-g2, native) — the TS face of the backup
 * inspection bridge, same lazy-probe discipline as the file bridge. Pure-web
 * runs and kernel tests inject a fake through ImportService's deps; the
 * browser fallback here just reports the platform lacks archive import.
 */

export interface ArchiveEntryInfo {
  name: string
  size: number
}

export interface ImportBridge {
  /** Streaming SAF open for LARGE archives (real backups are ~100 MB; the
   *  Java side copies through a 64 KB buffer — the renderer never holds the
   *  bytes). Loose small files ride zipFromBytes instead. */
  zipOpen(): Promise<{ sessionId: string; entries: ArchiveEntryInfo[] }>
  /** Small archives from the file input's bytes. */
  zipOpenBytes(bytes: Uint8Array): Promise<{ sessionId: string; entries: ArchiveEntryInfo[] }>
  zipRead(sessionId: string, entryName: string): Promise<Uint8Array>
  sqliteOpen(sessionId: string, entryName: string): Promise<string>
  kvAll(sqliteSessionId: string): Promise<Array<{ key: string; json: string | null }>>
  chatMessages(sqliteSessionId: string): Promise<Array<{ characterId: string; messageId: string; position: number; status: string | null; messageJson: string | null }>>
  close(handles: { sessionId?: string; sqliteSessionId?: string }): Promise<void>
}

export class ImportBridgeUnavailableError extends Error {
  constructor() {
    super('当前环境不支持备份文件导入(需要应用原生桥)')
    this.name = 'ImportBridgeUnavailableError'
  }
}

interface MpBackupBridge {
  zipOpen(): Promise<{ sessionId?: string; entries?: ArchiveEntryInfo[] }>
  zipFromBytes(call: { base64: string }): Promise<{ sessionId?: string; entries?: ArchiveEntryInfo[] }>
  zipRead(call: { sessionId: string; entryName: string }): Promise<{ base64?: string }>
  sqliteOpen(call: { sessionId: string; entryName: string }): Promise<{ sqliteSessionId?: string }>
  kvAll(call: { sqliteSessionId: string }): Promise<{ rows?: Array<{ key: string; json: string | null }> }>
  chatMessages(call: { sqliteSessionId: string }): Promise<{ rows?: Array<{ characterId: string; messageId: string; position: number; status: string | null; messageJson: string | null }> }>
  close(call: { sessionId?: string; sqliteSessionId?: string }): Promise<void>
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Chunked base64 for handing archive bytes across the bridge. */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

export const resolveImportBridge = (): ImportBridge | null => {
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins
  const bridge = plugins?.MpBackup
  if (!bridge || typeof bridge !== 'object') return null
  const native = bridge as MpBackupBridge
  return {
    async zipOpen() {
      const opened = await native.zipOpen()
      if (!opened.sessionId) throw Object.assign(new Error('cancelled'), { cancelled: true })
      return { sessionId: opened.sessionId, entries: opened.entries ?? [] }
    },
    async zipOpenBytes(bytes) {
      const opened = await native.zipFromBytes({ base64: bytesToBase64(bytes) })
      if (!opened.sessionId) throw new ImportBridgeUnavailableError()
      return { sessionId: opened.sessionId, entries: opened.entries ?? [] }
    },
    async zipRead(sessionId, entryName) {
      const read = await native.zipRead({ sessionId, entryName })
      return base64ToBytes(read.base64 ?? '')
    },
    async sqliteOpen(sessionId, entryName) {
      const opened = await native.sqliteOpen({ sessionId, entryName })
      if (!opened.sqliteSessionId) throw new ImportBridgeUnavailableError()
      return opened.sqliteSessionId
    },
    async kvAll(sqliteSessionId) {
      return (await native.kvAll({ sqliteSessionId })).rows ?? []
    },
    async chatMessages(sqliteSessionId) {
      return (await native.chatMessages({ sqliteSessionId })).rows ?? []
    },
    async close(handles) {
      await native.close(handles)
    },
  }
}
