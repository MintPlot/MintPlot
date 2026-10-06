/**
 * Import service (M4-g2, native) — the orchestration face the settings
 * section drives: inspect an archive (RP / ST detection), build the import
 * plan through the pure mappers, land the accepted parts into MP storage.
 *
 * Landing discipline: cards ride character-store.import (id assignment,
 * index upkeep, dedupe-free append); covers land as separate keys with a
 * mime sniffed from the archive entry extension (character-store's helper
 * hardcodes PNG); floors/envelopes/memory write through the storage
 * repository in the exact shapes the card-session store and memory engine
 * read back. RP presets merge into the preset store under one 'RP 导入'
 * group (fingerprint-deduped by the store itself). Nothing partial fails
 * the whole import — per-card failures collect as warnings.
 */

import { parseCharacterCardFile } from '@/kernel/characters/character-card'
import type { ParsedCharacterCard } from '@/kernel/characters/character-card'
import type { CharacterStore } from '@/kernel/characters/character-store'
import type { PresetStore } from '@/kernel/presets/preset-store'
import type { StorageRepository } from '@/kernel/store/storage-repository'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { ImportBridge } from './import-bridge'
import { detectBackupSource } from './backup-source'
import type { RpImportPlan } from './rp-import'
import { buildRpImportPlan } from './rp-import'
import type { StAsset, StAssetKind } from './st-import'
import { classifyStEntryName, classifyStJson, mapStPreset, mapStRegex, mapStWorldbook } from './st-import'

export interface ArchiveInspection {
  source: 'rp' | 'st'
  sessionId: string
  entries: Array<{ name: string; size: number }>
  /** RP only: archive entry name of the SQLite database. */
  databaseEntryName: string | null
  /** RP only: manifest fields worth showing. */
  rpInfo: { createdAt: number; databaseVersion: number } | null
}

export interface StPlanAsset {
  kind: StAssetKind
  name: string
  entryName: string
  /** worldbook: book object; regex: script list; preset: mapped entries. */
  payload: unknown
  notes?: string[]
  /** characters: the parsed card (imported via character-store). */
  card?: ParsedCharacterCard
}

export interface StImportPlan {
  assets: StPlanAsset[]
  warnings: string[]
}

export interface LandResult {
  importedCardIds: string[]
  presetCount: number
  warnings: string[]
}

export interface ImportService {
  inspectArchive(bytes: Uint8Array): Promise<ArchiveInspection>
  inspectStArchive(sessionId: string, entries: Array<{ name: string; size: number }>): Promise<StImportPlan>
  inspectLooseFiles(files: Array<{ name: string; bytes: Uint8Array }>): Promise<StImportPlan>
  buildRpPlan(sessionId: string, databaseEntryName: string, selectedUuids: string[], options: { includeGlobals: boolean; includePresets: boolean; listAll?: boolean }): Promise<{ plan: RpImportPlan; avatarBytes: Map<string, Uint8Array> }>
  landRp(plan: RpImportPlan, avatarBytes: Map<string, Uint8Array>): Promise<LandResult>
  landSt(plan: StImportPlan, targetCardId: string | null): Promise<LandResult>
  closeArchive(sessionId: string): Promise<void>
}

const mimeForEntry = (entryName: string): string => {
  const lowered = entryName.toLowerCase()
  if (lowered.endsWith('.png')) return 'image/png'
  if (lowered.endsWith('.webp')) return 'image/webp'
  if (lowered.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

const dataUrlFor = (entryName: string, bytes: Uint8Array): string => {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return `data:${mimeForEntry(entryName)};base64,${btoa(binary)}`
}

const now = (): number => Date.now()

export function createImportService(deps: {
  bridge: ImportBridge
  repository: StorageRepository
  characters: CharacterStore
  presets: PresetStore | null
}): ImportService {
  const { bridge, repository, characters, presets } = deps

  const readJsonEntry = async (sessionId: string, entryName: string): Promise<unknown> => {
    const bytes = await bridge.zipRead(sessionId, entryName)
    return JSON.parse(new TextDecoder('utf-8').decode(bytes))
  }

  return {
    async inspectArchive(bytes) {
      const { sessionId, entries } = await bridge.zipOpen(bytes)
      let manifestFormat: string | null = null
      let rpInfo: ArchiveInspection['rpInfo'] = null
      let databaseEntryName: string | null = null
      const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
      if (manifestEntry) {
        try {
          const manifest = (await readJsonEntry(sessionId, 'manifest.json')) as { format?: string; createdAt?: number; databaseVersion?: number }
          manifestFormat = typeof manifest.format === 'string' ? manifest.format : null
          if (manifestFormat === 'roleplay-hub-backup') {
            rpInfo = {
              createdAt: Number(manifest.createdAt) || 0,
              databaseVersion: Number(manifest.databaseVersion) || 0,
            }
            const dbEntry = entries.find((entry) => entry.name.startsWith('database/'))
            databaseEntryName = dbEntry?.name ?? null
          }
        } catch {
          manifestFormat = null // unreadable manifest → fall through to shape detection
        }
      }
      const source = detectBackupSource(entries, manifestFormat)
      if (!source) {
        await bridge.close({ sessionId })
        throw new Error('无法识别的备份文件(既不是 RP-Hub 也不是酒馆备份)')
      }
      return { source, sessionId, entries, databaseEntryName, rpInfo }
    },

    async inspectStArchive(sessionId, entries) {
      const plan: StImportPlan = { assets: [], warnings: [] }
      for (const entry of entries) {
        const kind = classifyStEntryName(entry.name)
        if (kind === 'unknown' || !entry.name.toLowerCase().endsWith('.json')) {
          // Characters inside a ST backup ride as PNG/JSON cards; anything
          // else (chats, settings, backups/) is out of 1.0.0 scope.
          if (kind === 'unknown' && /\.(png|json)$/i.test(entry.name) && entry.name.toLowerCase().includes('character')) {
            // handled below by the character branch
          } else if (!/\.(png|json)$/i.test(entry.name)) {
            continue
          }
        }
        try {
          if (kind === 'character' || /\.(png)$/i.test(entry.name)) {
            const bytes = await bridge.zipRead(sessionId, entry.name)
            const card = parseCharacterCardFile(bytes)
            plan.assets.push({ kind: 'character', name: card.name, entryName: entry.name, payload: null, card })
            continue
          }
          const raw = await readJsonEntry(sessionId, entry.name)
          const stem = entry.name.split('/').pop()?.replace(/\.json$/i, '') ?? entry.name
          if (kind === 'worldbook') {
            plan.assets.push({ kind, name: stem, entryName: entry.name, payload: mapStWorldbook(raw) })
          } else if (kind === 'regex') {
            plan.assets.push({ kind, name: stem, entryName: entry.name, payload: mapStRegex(raw) })
          } else if (kind === 'preset') {
            const mapped = mapStPreset(raw)
            plan.assets.push({ kind, name: stem, entryName: entry.name, payload: mapped.entries, notes: mapped.notes })
          } else {
            // Misplaced by directory — sniff the content.
            const sniffed = classifyStJson(raw)
            if (sniffed === 'unknown') continue
            plan.assets.push({ kind: sniffed, name: stem, entryName: entry.name, payload: sniffed === 'worldbook' ? mapStWorldbook(raw) : raw })
          }
        } catch (error) {
          plan.warnings.push(`${entry.name}:${(error as Error)?.message || '解析失败'}`)
        }
      }
      return plan
    },

    async inspectLooseFiles(files) {
      const plan: StImportPlan = { assets: [], warnings: [] }
      for (const file of files) {
        try {
          const stem = file.name.replace(/\.[^.]+$/, '')
          if (/\.png$/i.test(file.name)) {
            const card = parseCharacterCardFile(file.bytes)
            plan.assets.push({ kind: 'character', name: card.name, entryName: file.name, payload: null, card })
            continue
          }
          const raw = JSON.parse(new TextDecoder('utf-8').decode(file.bytes))
          const kind = classifyStJson(raw)
          if (kind === 'worldbook') {
            plan.assets.push({ kind, name: stem, entryName: file.name, payload: mapStWorldbook(raw) })
          } else if (kind === 'regex') {
            plan.assets.push({ kind, name: stem, entryName: file.name, payload: mapStRegex(raw) })
          } else if (kind === 'preset') {
            const mapped = mapStPreset(raw)
            plan.assets.push({ kind, name: stem, entryName: file.name, payload: mapped.entries, notes: mapped.notes })
          } else if (kind === 'character') {
            const card = parseCharacterCardFile(file.bytes)
            plan.assets.push({ kind, name: card.name, entryName: file.name, payload: null, card })
          } else {
            plan.warnings.push(`${file.name}:无法识别的文件类型`)
          }
        } catch (error) {
          plan.warnings.push(`${file.name}:${(error as Error)?.message || '解析失败'}`)
        }
      }
      return plan
    },

    async buildRpPlan(sessionId, databaseEntryName, selectedUuids, options) {
      if (!databaseEntryName) throw new Error('备份缺少数据库文件')
      const sqliteSessionId = await bridge.sqliteOpen(sessionId, databaseEntryName)
      try {
        const kvRows = await bridge.kvAll(sqliteSessionId)
        const chatRows = await bridge.chatMessages(sqliteSessionId)
        const plan = buildRpImportPlan(kvRows, chatRows, selectedUuids, options)
        const avatarBytes = new Map<string, Uint8Array>()
        for (const card of plan.cards) {
          if (!card.avatarEntryName) continue
          try {
            avatarBytes.set(card.rpUuid, await bridge.zipRead(sessionId, card.avatarEntryName))
          } catch {
            plan.warnings.push(`卡「${card.name}」头像读取失败,以默认占位导入`)
          }
        }
        return { plan, avatarBytes }
      } finally {
        await bridge.close({ sqliteSessionId })
      }
    },

    async landRp(plan, avatarBytes) {
      const importedCardIds: string[] = []
      const warnings: string[] = []
      for (const card of plan.cards) {
        try {
          // Mount plan globals into this card's extensions when the card has
          // none of its own (plan D3 semantics; the mapper already merged).
          const stored = await characters.import(card.card)
          importedCardIds.push(stored.id)
          const avatar = avatarBytes.get(card.rpUuid)
          if (avatar) {
            // Cover keys live beside the card; mime sniffed from the archive
            // entry (character-store's helper hardcodes PNG).
            const entryName = card.avatarEntryName ?? ''
            await repository.set(`character:cover:${stored.id}`, dataUrlFor(entryName, avatar))
          }
          if (card.floors.length > 0) {
            await repository.applyChatChanges(
              { kind: 'card', id: stored.id },
              card.floors.map((floor, position) => ({ position, message: JSON.parse(JSON.stringify(floor)) as ChatboxMessage, signature: `${position}` })),
              [],
            )
            const meta = {
              cardId: stored.id,
              title: stored.name,
              createdAt: card.floors[0]?.ts ?? now(),
              updatedAt: card.floors[card.floors.length - 1]?.ts ?? now(),
              preview: card.floors[card.floors.length - 1]?.content.slice(0, 60) ?? '',
            }
            await repository.set(`chatmeta:card:${stored.id}`, meta)
          }
          if (card.memory) {
            await repository.set(`memory:card:${stored.id}`, card.memory)
          }
        } catch (error) {
          warnings.push(`卡「${card.name}」导入失败:${(error as Error)?.message || '未知错误'}`)
        }
      }
      let presetCount = 0
      if (presets && plan.presets.length > 0) {
        for (const preset of plan.presets) {
          try {
            await presets.addEntry({ name: preset.name, content: preset.content, role: preset.role, enabled: false })
            presetCount += 1
          } catch (error) {
            warnings.push(`预设「${preset.name}」导入失败:${(error as Error)?.message || '未知错误'}`)
          }
        }
      }
      return { importedCardIds, presetCount, warnings: [...warnings, ...plan.warnings] }
    },

    async landSt(plan, targetCardId) {
      const importedCardIds: string[] = []
      const warnings: string[] = []
      let bookAdded = 0
      let regexAdded = 0
      let presetCount = 0
      for (const asset of plan.assets) {
        try {
          if (asset.kind === 'character' && asset.card) {
            const stored = await characters.import(asset.card)
            importedCardIds.push(stored.id)
            continue
          }
          if (asset.kind === 'preset' && presets) {
            const entries = Array.isArray(asset.payload) ? asset.payload : []
            for (const entry of entries as Array<{ name: string; content: string; role: 'system' | 'user' | 'assistant'; enabled: boolean }>) {
              if (!entry.content?.trim()) continue
              await presets.addEntry({ name: entry.name, content: entry.content, role: entry.role, enabled: entry.enabled !== false })
              presetCount += 1
            }
            continue
          }
          // Worldbook / regex mount into the chosen card's extensions.
          if (!targetCardId) {
            warnings.push(`「${asset.name}」需要选择目标卡(世界书与正则挂卡生效)`)
            continue
          }
          const card = await characters.get(targetCardId)
          if (!card) throw new Error('目标卡不存在')
          const extensions = { ...(card.extensions ?? {}) }
          if (asset.kind === 'worldbook') {
            const book = asset.payload as { entries: unknown[] }
            const existingBook = asRecord2(card.book)
            const existing = Array.isArray(existingBook.entries) ? (existingBook.entries as unknown[]) : []
            const existingKeys = new Set(
              existing.map((entry) => JSON.stringify(asRecord2(entry).content ?? '')),
            )
            const merged = [...existing, ...book.entries.filter((entry) => !existingKeys.has(JSON.stringify(asRecord2(entry).content ?? '')))]
            await characters.updateBook(targetCardId, { ...existingBook, entries: merged })
            bookAdded += merged.length - existing.length
          } else if (asset.kind === 'regex') {
            const scripts = Array.isArray(asset.payload) ? asset.payload : []
            const existing = Array.isArray(extensions.regex_scripts) ? (extensions.regex_scripts as unknown[]) : []
            const existingNames = new Set(existing.map((script) => String(asRecord2(script).name ?? '')))
            const merged = [...existing, ...scripts.filter((script) => !existingNames.has(String(asRecord2(script).name ?? '')))]
            extensions.regex_scripts = merged
            await characters.updateExtensions(targetCardId, extensions)
            regexAdded += merged.length - existing.length
          }
        } catch (error) {
          warnings.push(`「${asset.name}」导入失败:${(error as Error)?.message || '未知错误'}`)
        }
      }
      if (bookAdded || regexAdded) {
        // covered by warnings/notes in the panel result message
      }
      return { importedCardIds, presetCount, warnings: [...warnings, ...plan.warnings] }
    },

    async closeArchive(sessionId) {
      await bridge.close({ sessionId })
    },
  }
}

const asRecord2 = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** Asset-kind label for the panel. */
export const stAssetKindLabel = (kind: StAssetKind): string =>
  ({ worldbook: '世界书', regex: '正则', preset: '预设', character: '角色卡', unknown: '未知' })[kind]

export type { StAsset }
