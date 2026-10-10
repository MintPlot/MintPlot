/**
 * Backup service (M4-g1, native; M4-g4 container) — the orchestration face
 * the settings section drives: enumerate storage, build the envelope, write
 * it through the file bridge as a .zip container (single mintplot-backup.json
 * entry, store-only — see zip-archive); on restore, parse + full-replace +
 * reload (RP semantics: the confirm modal and the failure wording live in the
 * section, the replace discipline lives here).
 *
 * Wired through a module singleton (usage-stats service-instance pattern):
 * the composition root binds the raw KvEngine + platform info at boot; the
 * engine layer stores JSON strings, so entries move VERBATIM (plan D1 —
 * zero conversion, zero loss). The secret channel is never touched: secret
 * values are not idb keys, so a restore can neither leak nor clobber them.
 */

import type { KvEngine } from '@/kernel/store/kv-store'
import { MP_VERSION_NAME } from '@/kernel/app/app-identity'
import {
  BACKUP_LOCAL_STORAGE_KEYS,
  BackupEnvelopeError,
  createBackupEnvelope,
  isExcludedFromBackup,
  parseBackupEnvelope,
  serializeBackupEnvelope,
  type BackupEnvelope,
} from './backup-envelope'
import { looksLikeZipArchive, readZipArchiveEntry, writeZipArchive, ZipArchiveError } from './zip-archive'

/** The envelope rides inside the .zip container under this fixed entry name. */
export const BACKUP_CONTAINER_ENTRY_NAME = 'mintplot-backup.json'

export interface BackupService {
  /** Builds + persists the backup file; false = user cancelled the picker. */
  exportBackup(): Promise<boolean>
  /** Reads a backup file (the M4-g4 .zip container, or the legacy bare-JSON
   *  envelope); null = user cancelled the picker. Throws on a malformed
   *  container or envelope (BackupEnvelopeError). */
  readBackupFile(): Promise<BackupEnvelope>
  /** Full replace: writes every envelope key, removes current keys the
   *  envelope does not carry, mirrors localStorage, then RELOADS the app
   *  (route state and in-memory caches must not outlive the swap). */
  restoreBackup(envelope: BackupEnvelope): Promise<void>
  /** The envelope's own summary for confirm dialogs / toasts. */
  describeBackup(envelope: BackupEnvelope): string
}

const storageKeyPrefixPattern = /^mp/

export function createBackupService(deps: {
  engine: KvEngine
  fileBridge: () => { exportFile(fileName: string, mimeType: string, bytes: Uint8Array): Promise<boolean>; importFile(mimeType?: string): Promise<Uint8Array | null> }
}): BackupService {
  const { engine, fileBridge } = deps

  const collectKv = async (): Promise<Record<string, string>> => {
    const keys = await engine.keys()
    const kv: Record<string, string> = {}
    for (const key of keys) {
      if (isExcludedFromBackup(key)) continue
      const value = await engine.get(key)
      if (typeof value === 'string') kv[key] = value
    }
    return kv
  }

  const collectLocalStorage = (): Record<string, string> => {
    const entries: Record<string, string> = {}
    for (const key of BACKUP_LOCAL_STORAGE_KEYS) {
      const value = window.localStorage.getItem(key)
      if (value !== null) entries[key] = value
    }
    return entries
  }

  return {
    async exportBackup() {
      const envelope = createBackupEnvelope(await collectKv(), collectLocalStorage(), MP_VERSION_NAME)
      const json = serializeBackupEnvelope(envelope)
      const bytes = writeZipArchive([{ name: BACKUP_CONTAINER_ENTRY_NAME, data: new TextEncoder().encode(json) }])
      // Digits only — the bracketed char class this replaces used to leak
      // into Tailwind's candidate scanner and break the CSS build.
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
      return fileBridge().exportFile(`mintplot-${stamp}.zip`, 'application/zip', bytes)
    },

    async readBackupFile() {
      // No mime filter: the picker must offer both the .zip container and the
      // legacy .json envelope.
      const bytes = await fileBridge().importFile()
      if (!bytes) throw Object.assign(new Error('cancelled'), { cancelled: true })
      try {
        const text = looksLikeZipArchive(bytes)
          ? new TextDecoder().decode(await readZipArchiveEntry(bytes, BACKUP_CONTAINER_ENTRY_NAME))
          : new TextDecoder().decode(bytes)
        return parseBackupEnvelope(text)
      } catch (error) {
        if (error instanceof BackupEnvelopeError) throw error
        const reason = error instanceof ZipArchiveError ? error.message : '未知错误'
        throw new BackupEnvelopeError(`备份压缩包读取失败:${reason}`)
      }
    },

    async restoreBackup(envelope) {
      // Replace discipline: every envelope key lands verbatim, current keys
      // the envelope does not carry are removed, then a hard reload drops
      // all in-memory state. localStorage keys outside the appearance set
      // (browser/dev leftovers) are left alone.
      const removals: Promise<void>[] = []
      for (const key of await engine.keys()) {
        if (!(key in envelope.kv) && !isExcludedFromBackup(key)) removals.push(engine.remove(key))
      }
      await Promise.all(removals)
      for (const [key, value] of Object.entries(envelope.kv)) {
        await engine.set(key, value)
      }
      for (const key of BACKUP_LOCAL_STORAGE_KEYS) {
        if (key in envelope.localStorage) window.localStorage.setItem(key, envelope.localStorage[key]!)
        else if (window.localStorage.getItem(key) !== null && storageKeyPrefixPattern.test(key)) {
          window.localStorage.removeItem(key)
        }
      }
      window.location.reload()
    },

    describeBackup(envelope) {
      const date = envelope.createdAt ? new Date(envelope.createdAt).toLocaleString() : '未知时间'
      const app = envelope.appVersion ? ` · 应用 ${envelope.appVersion}` : ''
      return `${date}${app} · ${Object.keys(envelope.kv).length} 项数据`
    },
  }
}
