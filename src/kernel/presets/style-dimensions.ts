/**
 * Style dimensions for the preset system (planning style-dimension-presets-
 * plan S1): a dimension tags preset entries that describe HOW the story is
 * told (person / writing / length / style / mood / nsfw). Dimensions are
 * orthogonal to preset groups — a group is a named combination ("方案"), a
 * dimension is a facet within it. Single-select dimensions are mutually
 * exclusive (the store dims siblings); multi-select dimensions stack freely.
 * Leaving a dimension empty means "no constraint" — no placeholder entries.
 */

export type StyleDimension = 'person' | 'writing' | 'length' | 'style' | 'mood' | 'nsfw'

export interface StyleDimensionMeta {
  id: StyleDimension
  /** Chinese UI label (user-facing). */
  label: string
  /** true = several entries may be enabled at once; false = pick at most one. */
  multi: boolean
  /** Fixed position of this dimension's block in request assembly. */
  order: number
}

export const STYLE_DIMENSIONS: readonly StyleDimensionMeta[] = [
  { id: 'person', label: '人称', multi: false, order: 1 },
  { id: 'writing', label: '写法', multi: false, order: 2 },
  { id: 'length', label: '篇幅', multi: false, order: 3 },
  { id: 'style', label: '风格', multi: true, order: 4 },
  { id: 'mood', label: '氛围', multi: true, order: 5 },
  { id: 'nsfw', label: 'NSFW', multi: false, order: 6 },
]

const DIMENSION_BY_ID = new Map(STYLE_DIMENSIONS.map((meta) => [meta.id, meta]))

export const isStyleDimension = (value: unknown): value is StyleDimension =>
  typeof value === 'string' && DIMENSION_BY_ID.has(value as StyleDimension)

export const dimensionMeta = (id: StyleDimension): StyleDimensionMeta =>
  DIMENSION_BY_ID.get(id)!
