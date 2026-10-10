/**
 * Backup envelope (M4-g1, native) — the MP自有 backup format (plan D1): a
 * single JSON document carrying the storage keys VERBATIM (the idb engine
 * stores JSON strings, so kv entries move byte-for-byte with zero
 * conversion) plus the shell-level appearance localStorage entries.
 *
 * Excluded: the error journal (diagnostics are ephemeral, plan D5) and
 * everything on the secret channel (apiKey etc. — device-bound by design,
 * the same reasoning as RP's backup omitting its secret preferences).
 */

export const BACKUP_FORMAT = 'mintplot-backup'
export const BACKUP_FORMAT_VERSION = 1

/** Diagnostics ride their own export face (诊断分区) — never the backup. */
export const BACKUP_EXCLUDED_KEYS: readonly string[] = ['error-journal']

/** Shell-level appearance keys (PR#1 / theme v2) — the only localStorage
 *  entries the shell owns. */
export const BACKUP_LOCAL_STORAGE_KEYS: readonly string[] = ['mp_theme_pref', 'mp_color_family']

export interface BackupEnvelope {
  format: string
  formatVersion: number
  createdAt: number
  appVersion: string
  /** Raw idb key → stored JSON-string value, moved verbatim. */
  kv: Record<string, string>
  localStorage: Record<string, string>
}

export const isExcludedFromBackup = (key: string): boolean => BACKUP_EXCLUDED_KEYS.includes(key)

export const createBackupEnvelope = (
  kv: Record<string, string>,
  localStorage: Record<string, string>,
  appVersion: string,
): BackupEnvelope => ({
  format: BACKUP_FORMAT,
  formatVersion: BACKUP_FORMAT_VERSION,
  createdAt: Date.now(),
  appVersion,
  kv,
  localStorage,
})

export const serializeBackupEnvelope = (envelope: BackupEnvelope): string => JSON.stringify(envelope)

export class BackupEnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupEnvelopeError'
  }
}

export const parseBackupEnvelope = (text: string): BackupEnvelope => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupEnvelopeError('文件不是有效的 JSON 备份')
  }
  if (!parsed || typeof parsed !== 'object') throw new BackupEnvelopeError('备份内容为空')
  const envelope = parsed as Partial<BackupEnvelope>
  if (envelope.format !== BACKUP_FORMAT) throw new BackupEnvelopeError('不是 MintPlot 备份文件')
  if (typeof envelope.formatVersion !== 'number') throw new BackupEnvelopeError('备份缺少格式版本')
  if (envelope.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupEnvelopeError('备份来自更新版本的应用，请先升级应用')
  }
  if (!envelope.kv || typeof envelope.kv !== 'object') throw new BackupEnvelopeError('备份缺少存储数据')
  return {
    format: envelope.format,
    formatVersion: envelope.formatVersion,
    createdAt: typeof envelope.createdAt === 'number' ? envelope.createdAt : 0,
    appVersion: typeof envelope.appVersion === 'string' ? envelope.appVersion : '',
    kv: envelope.kv as Record<string, string>,
    localStorage: envelope.localStorage && typeof envelope.localStorage === 'object' ? envelope.localStorage : {},
  }
}
