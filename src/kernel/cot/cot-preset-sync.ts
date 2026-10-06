/**
 * COT preset sync (M4-f, native) — RP cot service syncCotPresetContent
 * behavior internalized (behavior source: plugins/cot/service.ts, not a code
 * port). Idempotently writes the generated `<thinking_protocol>` content into
 * the preset store as a managed 'COT' entry (default group, panel-visible,
 * user can disable it) and rewrites the two 破限预注入 · AI prefill entries
 * with pre-opened thinking blocks. When the COT entry is disabled the prefill
 * entries revert to their seed content (RP prefillEnabled semantics).
 *
 * Sync timing: before each request assembly (RP watches live state; the
 * idempotent sync achieves the same with one store read per send). The seed
 * version bump restores prefill seed content — the next send re-syncs, so
 * the pair self-heals.
 */

import { DEFAULT_PRESET_DEFINITIONS } from '@/kernel/presets/default-presets'
import type { PresetStore } from '@/kernel/presets/preset-store'
import { buildCotPresetContent, usesThinkingCotTag } from './cot-builder'

export const COT_PRESET_NAME = 'COT'

/** 破限预注入 · AI 1/2 — assistant prefills that pre-open the thinking block. */
const COT_PREFILL_NAMES = ['破限预注入 · AI 1', '破限预注入 · AI 2'] as const

export interface CotSyncInput {
  /** Active profile model — picks the <thinking> vs <cot> tag. */
  model: string
  memoryEnabled: boolean
  variablesAnalysisEnabled: boolean
}

export const syncCotPresetEntries = async (store: PresetStore, input: CotSyncInput): Promise<void> => {
  const base = {
    memoryEnabled: input.memoryEnabled,
    variablesAnalysisEnabled: input.variablesAnalysisEnabled,
    useThinkingOpening: usesThinkingCotTag(input.model),
  }
  const cotSnapshot = await store.syncManagedEntry({
    name: COT_PRESET_NAME,
    content: buildCotPresetContent(base),
    role: 'system',
  })
  const cotEnabled =
    cotSnapshot.entries.find((entry) => entry.name === COT_PRESET_NAME && entry.group === 'default')?.enabled !== false
  for (const [index, name] of COT_PREFILL_NAMES.entries()) {
    const seed = DEFAULT_PRESET_DEFINITIONS.find((definition) => definition.name === name)
    if (!seed) continue
    await store.syncManagedEntry(
      {
        name,
        content: buildCotPresetContent({
          ...base,
          prefillPhase: index + 1,
          prefillEnabled: cotEnabled,
          prefillBaseContent: seed.content,
        }),
        role: seed.role,
      },
      // User-deleted prefill entries stay deleted — sync only refreshes
      // survivors (RP returns early when the prefill preset is gone).
      { createIfMissing: false },
    )
  }
}
