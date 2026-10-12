/**
 * Prompt preset store (M3-w, native) — the RP presets organ internalized
 * (behavior source: plugins/presets/service.ts + app.mjs seeding; not a code
 * port). Model per planning D1: flat entries `{name, content, enabled, role,
 * group}` where ROLE is the injection selector (system → front of the system
 * prompt; user/assistant → standalone prefill messages before history);
 * array order = application order; exactly one group active at a time
 * (global mutex — switching groups swaps the whole set).
 *
 * v3 adds optional `dimension` (style-dimensions.ts): entries tagged with a
 * narrative facet; single-select dimensions are mutually exclusive at the
 * store level (generalizes the v2 person-pair mutex to every dimension
 * entry point). Seeding mirrors RP: version-driven sync of the built-in
 * default group — version bump rewrites default-group content/role/dimension
 * while keeping user toggles, adds missing, removes retired. Sensitive-class
 * entries (色情增强) ship disabled; 破限 ships ENABLED since v3 (planning D5,
 * untouched-store migration D9).
 */

import {
  DEFAULT_PRESET_DEFINITIONS,
  DEFAULT_PRESET_DEFINITIONS_VERSION,
  DEFAULT_TOGGLES_CHANGED_IN_V3,
  PERSON_MUTEX_SINCE_VERSION,
  PERSON_PERSPECTIVE_NAMES,
  STYLE_DIMENSIONS_SINCE_VERSION,
} from '@/kernel/presets/default-presets'
import { dimensionMeta, isStyleDimension, type StyleDimension } from '@/kernel/presets/style-dimensions'

export type PresetRole = 'system' | 'user' | 'assistant'

export interface PresetEntry {
  id: string
  name: string
  content: string
  enabled: boolean
  role: PresetRole
  group: string
  /** Style dimension tag (v3); absent = ordinary entry outside all dimensions. */
  dimension?: StyleDimension
}

export interface PresetGroup {
  id: string
  name: string
  builtin: boolean
  /** Global mutex: exactly one group carries true. */
  enabled: boolean
}

export interface PresetSnapshot {
  groups: PresetGroup[]
  entries: PresetEntry[]
}

export interface PresetStore {
  ensure(): Promise<PresetSnapshot>
  get(): Promise<PresetSnapshot>
  setActiveGroup(groupId: string): Promise<PresetSnapshot>
  setEntryEnabled(entryId: string, enabled: boolean): Promise<PresetSnapshot>
  /** `dimension: null` clears the tag; absent field leaves it unchanged. */
  updateEntry(entryId: string, patch: { name: string; content: string; role: PresetRole; dimension?: StyleDimension | null }): Promise<PresetSnapshot>
  addEntry(entry: { name: string; content: string; role: PresetRole; dimension?: StyleDimension; /** Importers land entries disabled (M4-g2) — user opts in via the panel. */ enabled?: boolean }): Promise<PresetSnapshot>
  removeEntry(entryId: string): Promise<PresetSnapshot>
  moveEntry(entryId: string, direction: -1 | 1): Promise<PresetSnapshot>
  /** Managed-entry sync (M4-f CoT): upsert by NAME in the default group —
   *  create (enabled) when absent, rewrite content/role when they differ,
   *  no-op otherwise. Content clobbering is intentional: managed entries are
   *  generated, not user-authored. `createIfMissing: false` respects user
   *  deletions (sync only refreshes surviving entries). */
  syncManagedEntry(
    patch: { name: string; content: string; role: PresetRole },
    options?: { createIfMissing?: boolean },
  ): Promise<PresetSnapshot>
  exportGroups(): Promise<string>
  importGroups(json: string): Promise<PresetSnapshot>
}

interface StoredRecord {
  version: number
  groups: PresetGroup[]
  entries: PresetEntry[]
}

const KEY_PRESETS = 'presets'
const KEY_GROUPS = 'preset_groups'
const KEY_VERSION = 'preset_definitions_version'
const DEFAULT_GROUP = 'default'

const newId = (): string => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const normalizeRole = (role: unknown): PresetRole =>
  role === 'user' || role === 'assistant' ? role : 'system'

/** Sanitize an incoming dimension tag: unknown/junk values drop to "no
 *  dimension" rather than poisoning the store (import path). */
const normalizeDimension = (value: unknown): StyleDimension | undefined =>
  isStyleDimension(value) ? value : undefined

const managedFields = (definition: { content: string; role: PresetRole; dimension?: StyleDimension }) => ({
  content: definition.content,
  role: definition.role,
  dimension: definition.dimension,
})

export function createPresetStore(repository: {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}): PresetStore {
  const write = async (snapshot: PresetSnapshot): Promise<void> => {
    await repository.set(KEY_PRESETS, snapshot.entries)
    await repository.set(KEY_GROUPS, snapshot.groups)
  }

  const seed = (): StoredRecord => ({
    version: DEFAULT_PRESET_DEFINITIONS_VERSION,
    groups: [{ id: DEFAULT_GROUP, name: '默认预设', builtin: true, enabled: true }],
    entries: DEFAULT_PRESET_DEFINITIONS.map((definition) => ({
      id: newId(),
      name: definition.name,
      ...managedFields(definition),
      enabled: definition.defaultEnabled,
      group: DEFAULT_GROUP,
    })),
  })

  /** RP seed-sync semantics: a version bump rewrites default-group
   *  content/role/dimension (keeping user toggles), adds missing definitions,
   *  and removes retired ones. Custom groups are never touched. */
  const syncVersion = async (): Promise<void> => {
    const applied = (await repository.get<number>(KEY_VERSION)) ?? 0
    if (applied === DEFAULT_PRESET_DEFINITIONS_VERSION) return
    const entries = (await repository.get<PresetEntry[]>(KEY_PRESETS)) ?? []
    if (entries.length === 0) {
      const fresh = seed()
      await write({ groups: fresh.groups, entries: fresh.entries })
      await repository.set(KEY_VERSION, DEFAULT_PRESET_DEFINITIONS_VERSION)
      return
    }
    const definitions = new Map(DEFAULT_PRESET_DEFINITIONS.map((definition) => [definition.name, definition]))
    const kept: PresetEntry[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      if (entry.group !== DEFAULT_GROUP) {
        kept.push(entry)
        continue
      }
      const definition = definitions.get(entry.name)
      if (!definition) continue // retired
      kept.push({ ...entry, ...managedFields(definition) })
      seen.add(entry.name)
    }
    for (const definition of DEFAULT_PRESET_DEFINITIONS) {
      if (seen.has(definition.name)) continue
      kept.push({
        id: newId(),
        name: definition.name,
        ...managedFields(definition),
        enabled: definition.defaultEnabled,
        group: DEFAULT_GROUP,
      })
    }
    // v2 migration: v1 shipped both perspective entries enabled — the pair
    // rides contradictory instructions into every request. Keep 第三人称,
    // retire the 第二人称 toggle. Gated to pre-v2 stores only: a deliberate
    // both-on re-enabled later must survive future version bumps.
    if (applied < PERSON_MUTEX_SINCE_VERSION) {
      const pair = kept.filter((entry) => (PERSON_PERSPECTIVE_NAMES as readonly string[]).includes(entry.name) && entry.enabled)
      if (pair.length > 1) {
        for (const entry of pair) {
          if (entry.name !== '第三人称') entry.enabled = false
        }
      }
    }
    // v3 migration (planning D9): definitions whose defaultEnabled changed
    // apply the new default only when the stored toggle still equals the OLD
    // default (= the user never touched it). A deliberate toggle survives —
    // including an explicit off, when it differs from the old default.
    if (applied < STYLE_DIMENSIONS_SINCE_VERSION) {
      for (const entry of kept) {
        if (entry.group !== DEFAULT_GROUP) continue
        const oldDefault = DEFAULT_TOGGLES_CHANGED_IN_V3.get(entry.name)
        if (oldDefault === undefined || entry.enabled !== oldDefault) continue
        entry.enabled = definitions.get(entry.name)!.defaultEnabled
      }
    }
    await write({ groups: (await repository.get<PresetGroup[]>(KEY_GROUPS)) ?? seed().groups, entries: kept })
    await repository.set(KEY_VERSION, DEFAULT_PRESET_DEFINITIONS_VERSION)
  }

  const load = async (): Promise<PresetSnapshot> => {
    await syncVersion()
    const groups = (await repository.get<PresetGroup[]>(KEY_GROUPS)) ?? seed().groups
    const entries = (await repository.get<PresetEntry[]>(KEY_PRESETS)) ?? []
    return { groups, entries }
  }

  /** Group mutex: the picked group goes on, everyone else goes off (RP set-
   *  ActivePresetGroup semantics). */
  const withMutex = (groups: PresetGroup[], groupId: string): PresetGroup[] =>
    groups.map((group) => ({ ...group, enabled: group.id === groupId }))

  return {
    async ensure() {
      return load()
    },

    async get() {
      return load()
    },

    async setActiveGroup(groupId) {
      const snapshot = await load()
      const groups = withMutex(snapshot.groups, groupId)
      await write({ ...snapshot, groups })
      return { ...snapshot, groups }
    },

    async setEntryEnabled(entryId, enabled) {
      const snapshot = await load()
      const target = snapshot.entries.find((entry) => entry.id === entryId)
      // Single-select dimension mutex at the store level: lighting one entry
      // in a single-select dimension dims its enabled siblings in the same
      // group — every entry point (presets panel, persona chips, per-card
      // style sheet) stays mutually exclusive, not just one selector.
      // Multi-select dimensions and ordinary entries pass through.
      const mutexDimension =
        enabled && target && isStyleDimension(target.dimension) && !dimensionMeta(target.dimension).multi
          ? target.dimension
          : undefined
      const entries = snapshot.entries.map((entry) => {
        if (entry.id === entryId) return { ...entry, enabled }
        if (
          mutexDimension !== undefined &&
          entry.enabled &&
          entry.dimension === mutexDimension &&
          entry.group === target!.group
        ) {
          return { ...entry, enabled: false }
        }
        return entry
      })
      await write({ ...snapshot, entries })
      return { ...snapshot, entries }
    },

    async updateEntry(entryId, patch) {
      const snapshot = await load()
      const entries = snapshot.entries.map((entry) => {
        if (entry.id !== entryId) return entry
        const next: PresetEntry = { ...entry, name: patch.name, content: patch.content, role: normalizeRole(patch.role) }
        if (patch.dimension === null) delete next.dimension
        else if (patch.dimension !== undefined) next.dimension = patch.dimension
        return next
      })
      await write({ ...snapshot, entries })
      return { ...snapshot, entries }
    },

    async addEntry(entry) {
      const snapshot = await load()
      const activeGroup = snapshot.groups.find((group) => group.enabled)?.id ?? DEFAULT_GROUP
      const next = [
        ...snapshot.entries,
        {
          id: newId(),
          name: entry.name,
          content: entry.content,
          enabled: entry.enabled !== false,
          role: normalizeRole(entry.role),
          group: activeGroup,
          ...(entry.dimension ? { dimension: entry.dimension } : {}),
        },
      ]
      await write({ ...snapshot, entries: next })
      return { ...snapshot, entries: next }
    },

    async removeEntry(entryId) {
      const snapshot = await load()
      const entries = snapshot.entries.filter((entry) => entry.id !== entryId)
      await write({ ...snapshot, entries })
      return { ...snapshot, entries }
    },

    async moveEntry(entryId, direction) {
      const snapshot = await load()
      const index = snapshot.entries.findIndex((entry) => entry.id === entryId)
      const target = index + direction
      if (index === -1 || target < 0 || target >= snapshot.entries.length) return snapshot
      const entries = [...snapshot.entries]
      const [moved] = entries.splice(index, 1)
      entries.splice(target, 0, moved!)
      await write({ ...snapshot, entries })
      return { ...snapshot, entries }
    },

    async syncManagedEntry(patch, options) {
      const snapshot = await load()
      const role = normalizeRole(patch.role)
      const existing = snapshot.entries.find((entry) => entry.group === DEFAULT_GROUP && entry.name === patch.name)
      if (!existing) {
        if (options?.createIfMissing === false) return snapshot
        const next = [
          ...snapshot.entries,
          { id: newId(), name: patch.name, content: patch.content, enabled: true, role, group: DEFAULT_GROUP },
        ]
        await write({ ...snapshot, entries: next })
        return { ...snapshot, entries: next }
      }
      if (existing.content === patch.content && existing.role === role) return snapshot
      const entries = snapshot.entries.map((entry) =>
        entry.id === existing.id ? { ...entry, content: patch.content, role } : entry)
      await write({ ...snapshot, entries })
      return { ...snapshot, entries }
    },

    /** RP group-bundle format: {type:'rp-hub-preset-groups', groups, presets}. */
    async exportGroups() {
      const snapshot = await load()
      return JSON.stringify({ type: 'rp-hub-preset-groups', groups: snapshot.groups, presets: snapshot.entries }, null, 2)
    },

    async importGroups(json) {
      const parsed = JSON.parse(json) as { groups?: PresetGroup[]; presets?: PresetEntry[]; presetsList?: PresetEntry[] }
      const incomingGroups = Array.isArray(parsed.groups) ? parsed.groups : []
      const incomingEntries = Array.isArray(parsed.presets) ? parsed.presets : (Array.isArray(parsed.presetsList) ? parsed.presetsList : [])
      if (incomingGroups.length === 0 && incomingEntries.length === 0) throw new Error('预设文件没有可导入的内容')
      const snapshot = await load()
      // Group merge: keep the default group id, new ids pass through; entries
      // remap onto merged groups; role+content fingerprint dedupe.
      const existingIds = new Set(snapshot.groups.map((group) => group.id))
      const mergedGroups = [
        ...snapshot.groups,
        ...incomingGroups
          .filter((group) => !existingIds.has(group.id) && group.id !== DEFAULT_GROUP)
          .map((group) => ({ id: String(group.id ?? newId()), name: String(group.name ?? '导入组'), builtin: false, enabled: false })),
      ]
      const fingerprint = (entry: { role: string; content: string }): string => `${normalizeRole(entry.role)}|${entry.content}`
      const fingerprints = new Set(snapshot.entries.map(fingerprint))
      const mergedEntries = [...snapshot.entries]
      for (const raw of incomingEntries) {
        const dimension = normalizeDimension((raw as { dimension?: unknown }).dimension)
        const entry: PresetEntry = {
          id: newId(),
          name: String(raw.name ?? '导入条目'),
          content: String(raw.content ?? ''),
          enabled: raw.enabled !== false,
          role: normalizeRole(raw.role),
          group: mergedGroups.some((group) => group.id === raw.group) ? String(raw.group) : DEFAULT_GROUP,
          ...(dimension ? { dimension } : {}),
        }
        if (!entry.content.trim() || fingerprints.has(fingerprint(entry))) continue
        fingerprints.add(fingerprint(entry))
        mergedEntries.push(entry)
      }
      const next: PresetSnapshot = { groups: mergedGroups, entries: mergedEntries }
      await write(next)
      return next
    },
  }
}
