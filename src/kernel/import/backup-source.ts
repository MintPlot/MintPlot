/**
 * Backup source detection (M4-g2, native) — sniffs an archive's entry list
 * (or a loose file's content) into the import pipeline's source type. RP
 * backups carry manifest.json with format 'roleplay-hub-backup'; ST
 * Download-Backup zips mirror ST's data directory; anything else with
 * recognizable JSON assets is treated as loose ST assets.
 */

import type { StAssetKind } from './st-import'

export type BackupSource = 'rp' | 'st'

export interface ArchiveEntryInfo {
  name: string
  size: number
}

export const detectBackupSource = (
  entries: ArchiveEntryInfo[],
  manifestFormat: string | null,
): BackupSource | null => {
  if (manifestFormat === 'roleplay-hub-backup') return 'rp'
  const names = entries.map((entry) => entry.name.toLowerCase())
  if (names.some((name) => name.startsWith('database/') || name === 'manifest.json')) return 'rp'
  if (names.some((name) => name.includes('worlds/') || name.includes('presets/') || name.includes('characters/') || name.includes('regex'))) {
    return 'st'
  }
  return null
}

/** Loose JSON sniffing for the multi-file import path. Delegates to the ST
 *  asset classifier — loose community files ARE ST-shape assets. */
export const classifyLooseJson = (raw: unknown): StAssetKind => {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (typeof record.entries === 'object' && record.entries !== null) return 'worldbook'
  if (Array.isArray(record.prompts)) return 'preset'
  if (typeof (record.scriptName ?? record.findRegex ?? record.regex) === 'string') return 'regex'
  if (typeof record.spec === 'string' && record.spec.startsWith('chara_card')) return 'character'
  if (typeof record.name === 'string' && (typeof record.first_mes === 'string' || typeof record.description === 'string')) {
    return 'character'
  }
  return 'unknown'
}
