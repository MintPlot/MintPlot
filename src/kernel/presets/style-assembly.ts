/**
 * Style-dimension assembly (planning style-dimension-presets-plan S2): pure
 * resolution + rendering of the dimension block — the tagged slice of the
 * preset system that carries HOW the story is told (person / writing /
 * length / style / mood / nsfw). Three sources per planning D6:
 *
 * - global: enabled dimension entries of the ACTIVE group (chatbox domain
 *   and card sessions following global);
 * - card override: CardStyleSelection.picks resolved by entry id across the
 *   WHOLE library, any group, regardless of the store toggle (D13) — a pick
 *   referencing a deleted entry resolves to `missing` (disclosure only);
 * - a dimension tag forces the entry into the dimension block (system
 *   channel) — tagged entries never ride the prefill slot (assembly side).
 *
 * Output renders `[名]\n内容` joined by blank lines in the fixed dimension
 * order; request-assembly splices it right after the plain preset system
 * entries, before the character block.
 */
import { STYLE_DIMENSIONS, isStyleDimension, type StyleDimension } from '@/kernel/presets/style-dimensions'
import type { PresetEntry, PresetSnapshot } from '@/kernel/presets/preset-store'

/** CardSession.style envelope field (S3 persists it per card). */
export interface CardStyleSelection {
  followGlobal: boolean
  /** Entry ids per dimension; single-select dimensions carry at most one —
   *  the writer truncates, the resolver re-truncates defensively. */
  picks: Partial<Record<StyleDimension, string[]>>
}

export interface StyleBlockItem {
  dimension: StyleDimension
  /** null when a card pick references a deleted entry (disclosure only). */
  entry: PresetEntry | null
  source: 'global' | 'card'
  missing?: boolean
}

const dimensionOrder = (dimension: StyleDimension): number =>
  STYLE_DIMENSIONS.find((meta) => meta.id === dimension)?.order ?? Number.MAX_SAFE_INTEGER

const isSingleSelect = (dimension: StyleDimension): boolean =>
  !STYLE_DIMENSIONS.find((meta) => meta.id === dimension)?.multi

/** Resolution per planning §4: card override > global; chatbox = global. */
export function resolveStyleBlock(
  snapshot: PresetSnapshot,
  selection: CardStyleSelection | null | undefined,
  isCardDomain: boolean,
): StyleBlockItem[] {
  const indexOfEntry = new Map(snapshot.entries.map((entry, index) => [entry.id, index] as const))
  const withIndex: Array<{ item: StyleBlockItem; libraryIndex: number }> = []
  // The object itself or null — a bare `a && b && c` chain would hand back a
  // boolean when all three hold, losing the picks.
  const useCard = isCardDomain && selection && !selection.followGlobal ? selection : null

  if (!useCard) {
    const activeGroup = snapshot.groups.find((group) => group.enabled)?.id ?? 'default'
    snapshot.entries.forEach((entry, index) => {
      if (!isStyleDimension(entry.dimension) || !entry.enabled || entry.group !== activeGroup) return
      withIndex.push({
        item: { dimension: entry.dimension, entry, source: 'global' },
        libraryIndex: index,
      })
    })
  } else {
    let pickSequence = 0
    for (const [dimension, ids] of Object.entries(useCard.picks)) {      if (!isStyleDimension(dimension) || !ids?.length) continue
      const wanted = isSingleSelect(dimension) ? ids.slice(0, 1) : ids
      for (const id of wanted) {
        const entry = snapshot.entries.find((candidate) => candidate.id === id) ?? null
        withIndex.push({
          item: entry
            ? { dimension, entry, source: 'card' }
            : { dimension, entry: null, source: 'card', missing: true },
          // Found entries sort by library order; deleted picks sink behind
          // them within the dimension, in pick order.
          libraryIndex: entry ? (indexOfEntry.get(id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER + (pickSequence += 1),
        })
      }
    }
  }

  withIndex.sort((a, b) => {
    const byDimension = dimensionOrder(a.item.dimension) - dimensionOrder(b.item.dimension)
    if (byDimension !== 0) return byDimension
    return a.libraryIndex - b.libraryIndex
  })
  return withIndex.map(({ item }) => item)
}

/** The system-area text of the dimension block; empty when nothing resolves.
 *  Deleted picks and blank-content entries inject nothing (the sheet's
 *  装配披露 renders them separately from this). */
export function renderStyleBlock(items: StyleBlockItem[]): string {
  return items
    .filter((item) => item.entry && item.entry.content.trim())
    .map((item) => `[${item.entry!.name}]\n${item.entry!.content}`)
    .join('\n\n')
}
