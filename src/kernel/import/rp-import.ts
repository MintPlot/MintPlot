/**
 * RP backup mapping (M4-g2, native) — pure functions turning the RP-Hub
 * backup contents (kv_store rows + chat_messages rows, as read by the
 * MpBackup bridge) into an import plan the service lands into MP storage.
 *
 * Key insight that keeps this small: RP's own card export projection
 * (buildCharacterCardData) already emits ccv3/v2-shaped JSON — the same
 * shape MP's character-card parser eats since M3-f. So cards map by
 * RE-PROJECTING the RP record into v2 JSON (worldInfo/regexScripts/
 * uiTemplates through RP's export-entry mappers, internalized below) and
 * feeding the existing parser; no second card model is introduced.
 *
 * Memory maps almost 1:1 (M4-e was authored against RP's model):
 * memory_summaries_<uuid> {long, short, batches, updatedAt} → MemoryState,
 * with the anchor pinned at the imported floor count (RP's summaries are a
 * full-coverage rewrite chain — nothing left to summarize).
 */

import { parseCharacterCardJson } from '@/kernel/characters/character-card'
import type { CharacterCard, ParsedCharacterCard } from '@/kernel/characters/character-card'
import type { MemoryState } from '@/kernel/memory/memory-engine'
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'

export interface RpKvRow {
  key: string
  json: string | null
}

export interface RpChatRow {
  characterId: string
  messageId: string
  position: number
  status: string | null
  messageJson: string | null
}

export interface RpCharacterRecord {
  uuid?: string
  name?: string
  avatar?: string
  worldInfo?: unknown[]
  regexScripts?: unknown[]
  uiTemplates?: unknown[]
  [key: string]: unknown
}

/** The plan: everything the service needs to land, nothing touching storage. */
export interface RpImportPlan {
  cards: RpImportPlanCard[]
  /** RP global assets — mounted into EVERY imported card's extensions
   *  (plan D3: RP globals mean "active for all cards"; per-card mounting is
   *  the closest MP semantics while the global-library layer is deferred). */
  globalWorldInfo: unknown[]
  globalRegex: unknown[]
  globalUiTemplates: unknown[]
  /** RP preset entries → the MP preset store, one 'RP 导入' group. */
  presets: RpImportPreset[]
  warnings: string[]
}

export interface RpImportPlanCard {
  rpUuid: string
  name: string
  /** Parsed card (via MP's own parser) ready for character-store.import. */
  card: ParsedCharacterCard
  /** Archive entry carrying the avatar image bytes (cover), if any. */
  avatarEntryName: string | null
  /** Chat floors for this card, storage-ready. */
  floors: ChatboxMessage[]
  memory: MemoryState | null
}

export interface RpImportPreset {
  name: string
  content: string
  enabled: boolean
  role: 'system' | 'user' | 'assistant'
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const toNumber = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback

/** RP worldinfo entry → the ccv3-shaped export entry (RP toWorldInfoExportEntry
 *  internalized — M3-u's engine projects this exact shape). */
export const worldInfoExportEntry = (entry: unknown): Record<string, unknown> => {
  const record = asRecord(entry)
  return {
    comment: record.comment || record.name || '',
    content: record.content || '',
    enabled: toBoolean(record.enabled, true),
    scope: record.scope || 'character',
    keys: asArray(record.keys),
    useRegex: toBoolean(record.useRegex, false),
    constant: toBoolean(record.constant, false),
    position: record.position || 'at_depth',
    order: toNumber(record.order, 0),
    depth: toNumber(record.depth, 4),
    scanDepth: toNumber(record.scanDepth, null as unknown as number),
    probability: toNumber(record.probability, 100),
    useProbability: toBoolean(record.useProbability, true),
  }
}

/** RP regex script → the export shape (RP toRegexExportEntry internalized —
 *  the dual field family M3-v's engine already consumes). */
export const regexExportEntry = (script: unknown): Record<string, unknown> => {
  const record = asRecord(script)
  const placement = asArray(record.placement)
    .map(Number)
    .filter((value) => value === 1 || value === 2)
  const markdownOnly = toBoolean(record.markdownOnly, false)
  const promptOnly = markdownOnly ? false : toBoolean(record.promptOnly, false)
  return {
    name: record.name || record.scriptName || '',
    regex: record.regex || record.findRegex || '',
    flags: record.flags || record.regexFlags || 'g',
    replacement: record.replacement !== undefined ? record.replacement : (record.replaceString || ''),
    placement: placement.length ? placement : [2],
    markdownOnly,
    promptOnly,
    runOnEdit: toBoolean(record.runOnEdit, false),
    minDepth: toNumber(record.minDepth, null as unknown as number),
    maxDepth: toNumber(record.maxDepth, null as unknown as number),
    scope: record.scope || 'character',
    disabled: record.disabled !== undefined ? toBoolean(record.disabled, false) : !toBoolean(record.enabled, true),
  }
}

/** RP ui template → the export shape RP's card export carries (M3-r's
 *  `rp_hub_ui_templates` channel consumes these verbatim). */
export const uiTemplateExportEntry = (template: unknown): Record<string, unknown> => {
  const record = asRecord(template)
  return {
    id: record.id,
    name: record.name || 'UI模板',
    ...(record.placement !== undefined ? { placement: record.placement } : { placement: 'top' }),
    ...(record.widthLayout !== undefined ? { widthLayout: record.widthLayout } : {}),
    variableState: asRecord(record.variableState),
    template: record.template ?? '',
    ...(record.variableSchema !== undefined ? { variableSchema: record.variableSchema } : {}),
    ...(record.updateMode !== undefined ? { updateMode: record.updateMode } : {}),
  }
}

/** Projects an RP character record into a v2 card JSON document (RP
 *  buildCharacterCardData behavior internalized) and runs MP's own parser. */
export const mapRpCharacterCard = (record: RpCharacterRecord): ParsedCharacterCard => {
  const worldEntries = asArray(record.worldInfo).map(worldInfoExportEntry)
  const regexScripts = asArray(record.regexScripts).map(regexExportEntry)
  const uiTemplates = asArray(record.uiTemplates).map(uiTemplateExportEntry)
  const cardJson = {
    spec: 'chara_card_v2',
    data: {
      name: record.name ?? '',
      description: record.description ?? '',
      personality: record.personality ?? '',
      scenario: record.scenario ?? '',
      first_mes: record.first_mes ?? '',
      mes_example: record.mes_example ?? '',
      system_prompt: record.system_prompt ?? '',
      post_history_instructions: record.post_history_instructions ?? '',
      alternate_greetings: asArray(record.alternate_greetings),
      tags: asArray(record.tags),
      creator: record.creator ?? '',
      character_version: record.character_version ?? '',
      creator_notes: record.creator_notes ?? '',
      extensions: {
        ...(asRecord(record.rawExtensions) as Record<string, unknown>),
        ...(regexScripts.length ? { regex_scripts: regexScripts } : {}),
        ...(uiTemplates.length ? { rp_hub_ui_templates: uiTemplates } : {}),
      },
      ...(worldEntries.length ? { character_book: { entries: worldEntries } } : {}),
    },
  }
  return parseCharacterCardJson(cardJson)
}

/** RP avatar value ("file:///…/media/<name>.jpg") → the archive entry name. */
export const rpAvatarEntryName = (avatar: unknown): string | null => {
  const value = typeof avatar === 'string' ? avatar : ''
  if (!value) return null
  const marker = '/media/'
  const index = value.lastIndexOf(marker)
  if (index === -1) return null
  return `media/${value.slice(index + marker.length)}`
}

interface RpMemorySummaries {
  long?: unknown
  short?: unknown
  [key: string]: unknown
}

interface RpMemoryProfile {
  characters?: unknown
  relations?: unknown
  openPlots?: unknown
  [key: string]: unknown
}

/** memory_summaries_<uuid> + memory_profile_<uuid> → MP MemoryState; the
 *  anchor pins at the imported floor count (full coverage — RP's rewrite
 *  chain already summarized everything the archive contains). */
export const mapRpMemory = (
  summaries: RpMemorySummaries | null,
  profile: RpMemoryProfile | null,
  floorCount: number,
): MemoryState | null => {
  const long = String(summaries?.long ?? '').trim()
  const short = String(summaries?.short ?? '').trim()
  const state: MemoryState = { ...createEmptyMemoryState(), anchor: floorCount, updatedAt: Date.now() }
  if (!long && !short && !profile) return null
  state.long = long
  state.short = short
  if (profile) {
    state.profile = {
      characters: asArray(profile.characters),
      relations: asArray(profile.relations),
      openPlots: asArray(profile.openPlots),
    } as MemoryState['profile']
  }
  return state
}

/** RP chat rows for one card → storage-ready floors (role/content/id verbatim
 *  from message_json; reasoning rides M4-f's field name; ts falls back to an
 *  ordered synthetic clock when the archive lacks one). */
export const mapRpFloors = (rows: RpChatRow[], characterId: string): ChatboxMessage[] => {
  const ordered = rows
    .filter((row) => row.characterId === characterId)
    .sort((a, b) => a.position - b.position)
  const floors: ChatboxMessage[] = []
  let clock = Date.now() - ordered.length * 1000
  for (const row of ordered) {
    let message: Record<string, unknown>
    try {
      message = asRecord(JSON.parse(row.messageJson ?? '{}'))
    } catch {
      continue // corrupt row → skip (the rest of the archive still imports)
    }
    const role = message.role === 'assistant' || message.role === 'user' ? message.role : 'assistant'
    const content = typeof message.content === 'string' ? message.content : ''
    if (!content && role === 'assistant') continue // RP keeps empty assistant shells
    const ts = Number(message.timestamp) || Number(message.ts) || clock
    clock += 1000
    floors.push({
      id: typeof message.id === 'string' && message.id ? message.id : row.messageId || `m-${clock.toString(36)}`,
      role,
      content,
      ts,
      ...(role === 'assistant' && typeof message.reasoning === 'string' && message.reasoning ? { reasoning: message.reasoning } : {}),
      ...(row.status === 'draft' ? { storageStatus: 'draft' as const } : {}),
    })
  }
  return floors
}

/** Full RP kv mirror → import plan. `selectedUuids` filters the cards;
 *  `options.listAll` lists EVERY card instead (the picker's initial browse
 *  mode — the UI checks them all by default and rebuilds filtered plans on
 *  toggle). Globals mount into the selected cards only. */
export const buildRpImportPlan = (
  kvRows: RpKvRow[],
  chatRows: RpChatRow[],
  selectedUuids: string[],
  options: { includeGlobals: boolean; includePresets: boolean; listAll?: boolean } = { includeGlobals: true, includePresets: true },
): RpImportPlan => {
  const kv = new Map<string, unknown>()
  for (const row of kvRows) {
    if (row.json === null || row.json === undefined) continue
    try {
      kv.set(row.key, JSON.parse(row.json))
    } catch {
      // Corrupt kv value → treat as absent.
    }
  }

  // RP stores its keys under an `rp_hub_` prefix (storageKey wrapper) — real
  // v161-era backups carry rp_hub_characters etc.; accept the bare form too
  // (synthetic samples, future format drift).
  const kvKey = (name: string): string => (kv.has(`rp_hub_${name}`) ? `rp_hub_${name}` : name)
  const characters = asArray(kv.get(kvKey('characters'))) as RpCharacterRecord[]
  const warnings: string[] = []
  const selected = new Set(selectedUuids)
  const chosen = options.listAll
    ? characters.filter((record) => typeof record.uuid === 'string' && record.uuid)
    : characters.filter((record) => {
        const uuid = typeof record.uuid === 'string' ? record.uuid : ''
        return uuid && selected.has(uuid)
      })
  if (!options.listAll) {
    for (const uuid of selectedUuids) {
      if (!characters.some((record) => record.uuid === uuid)) warnings.push(`卡 ${uuid} 在备份中不存在，已跳过`)
    }
  }

  const globalWorldInfo = options.includeGlobals ? asArray(kv.get(kvKey('global_worldinfo'))).map(worldInfoExportEntry) : []
  const globalRegex = options.includeGlobals ? asArray(kv.get(kvKey('global_regex'))).map(regexExportEntry) : []
  const globalUiTemplates = options.includeGlobals ? asArray(kv.get(kvKey('global_ui_templates'))).map(uiTemplateExportEntry) : []
  if ((globalWorldInfo.length || globalRegex.length || globalUiTemplates.length) && chosen.length === 0 && options.includeGlobals) {
    warnings.push('RP 全局世界书/正则/UI模板将随选中的卡挂载；未选卡则不导入')
  }

  const presets: RpImportPreset[] = []
  if (options.includePresets) {
    for (const raw of asArray(kv.get(kvKey('presets')))) {
      const record = asRecord(raw)
      const name = String(record.name ?? '').trim()
      const content = String(record.content ?? '')
      if (!name || !content.trim()) continue
      const role = record.role === 'user' || record.role === 'assistant' ? record.role : 'system'
      presets.push({ name, content, enabled: false, role })
    }
  }

  const cards: RpImportPlanCard[] = []
  for (const record of chosen) {
    const rpUuid = String(record.uuid ?? '')
    try {
      const card = mapRpCharacterCard(record)
      const floors = mapRpFloors(chatRows, rpUuid)
      const summaries = asRecord(kv.get(kvKey(`memory_summaries_${rpUuid}`))) as RpMemorySummaries
      const hasSummaries = Object.keys(summaries).length > 0
      const profile = asRecord(kv.get(kvKey(`memory_profile_${rpUuid}`))) as RpMemoryProfile
      const hasProfile = Object.keys(profile).length > 0
      // Globals mount into THIS card's extensions (never overwrite the
      // card's own embedded assets).
      const extensions = asRecord((card.extensions ?? {}) as Record<string, unknown>)
      if (globalWorldInfo.length && !extensions.character_book_worldinfo_global) {
        extensions.rp_imported_global_worldinfo = globalWorldInfo
      }
      if (globalRegex.length && !extensions.regex_scripts_global) {
        extensions.rp_imported_global_regex = globalRegex
      }
      if (globalUiTemplates.length && !extensions.rp_hub_ui_templates_global) {
        extensions.rp_imported_global_ui_templates = globalUiTemplates
      }
      cards.push({
        rpUuid,
        name: card.name,
        card: {
          ...card,
          extensions,
        },
        avatarEntryName: rpAvatarEntryName(record.avatar),
        floors,
        memory: hasSummaries || hasProfile ? mapRpMemory(hasSummaries ? summaries : null, hasProfile ? profile : null, floors.length) : null,
      })
    } catch (error) {
      warnings.push(`卡「${String(record.name ?? rpUuid)}」解析失败：${(error as Error)?.message || '未知错误'}`)
    }
  }

  return { cards, globalWorldInfo, globalRegex, globalUiTemplates, presets, warnings }
}

/** The globals the plan carries, in the exact shape MP's engines consume —
 *  the service mounts them into each imported card's extensions. */
export const planGlobalAssets = (plan: RpImportPlan): { worldInfo: unknown[]; regex: unknown[]; uiTemplates: unknown[] } => ({
  worldInfo: plan.globalWorldInfo,
  regex: plan.globalRegex,
  uiTemplates: plan.globalUiTemplates,
})

/** Type re-export for the service/UI layer. */
export type { CharacterCard }
