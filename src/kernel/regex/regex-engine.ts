/**
 * Regex engine (M3-v, native) — card-embedded find/replace scripts,
 * ecosystem semantics internalized (behavior sources: SillyTavern Regex
 * extension doc + RP useRegexPipeline inventory; not a code port).
 *
 * Two card field families coexist in the wild and both project here:
 * ST (`scriptName/findRegex/replaceString/regexFlags`) and the variant the
 * 蛊真人-class cards ship (`name/regex/flags/replacement`). Surfaces:
 *  - display: floor rendering, depth always 0;
 *  - prompt: the outgoing request (per message, never system blocks), depth
 *    anchored from the end (0 = last message).
 * Flag matrix (RP semantics, deliberately diverging from ST whose all-false
 * default mutates the chat file irreversibly): all-false = DISPLAY ONLY (the
 * dominant card shape — beautification regexes must not pump styled HTML
 * into the prompt); promptOnly = prompt only; markdownOnly = display;
 * both true → display. Storage floors are never mutated — every application
 * is a projection (落库纪律).
 */

export interface RegexScript {
  uid: number
  name: string
  pattern: string
  flags: string
  replacement: string
  /** 1 = user input, 2 = AI output (ST numeric placement). */
  placement: number[]
  enabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  minDepth: number | null
  maxDepth: number | null
}

export type RegexSurface = 'display' | 'prompt'

const toText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** `/pattern/flags` literal parsing (last slash splits; flags validated). */
export function parseRegexLiteral(raw: string): { pattern: string; flags: string } | null {
  if (raw.length < 2 || !raw.startsWith('/')) return null
  const lastSlash = raw.lastIndexOf('/')
  if (lastSlash === 0) return null
  const pattern = raw.slice(1, lastSlash)
  const flags = raw.slice(lastSlash + 1)
  if (!/^[gimsuy]*$/.test(flags)) return null
  return { pattern, flags: flags || 'g' }
}

/** Projects one raw script (dual field families, ST `disabled` inverted). */
export function projectRegexScript(raw: unknown, uid: number): RegexScript | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const name = toText(source.scriptName ?? source.name)
  let pattern = toText(source.findRegex ?? source.regex)
  let flags = toText(source.regexFlags ?? source.flags) || 'g'
  const literal = parseRegexLiteral(pattern)
  if (literal) {
    pattern = literal.pattern
    flags = literal.flags
  }
  if (!pattern) return null
  const disabled = source.disabled === true
  // Explicit fields win in order (enabled → disabled → default-on). The old
  // `source.enabled === true || !disabled` coerced an explicit enabled:false
  // into enabled whenever no `disabled` key existed — author-disabled scripts
  // ran anyway.
  const enabled = source.enabled === undefined ? !disabled : source.enabled === true
  // Placement values are NUMERIC roles (1 user / 2 assistant) — stringified
  // entries are coerced back so includes() matches.
  const placementRaw = Array.isArray(source.placement)
    ? source.placement.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : null
  const placement = placementRaw && placementRaw.length > 0 ? placementRaw : [1, 2]
  // Flag normalization (RP same): both-true collapses to display-only.
  const markdownOnly = source.markdownOnly === true
  const promptOnly = markdownOnly && source.promptOnly === true ? false : source.promptOnly === true
  return {
    uid,
    name,
    pattern,
    flags,
    replacement: toText(source.replaceString ?? source.replacement),
    placement: placement.includes(1) || placement.includes(2) ? placement : [1, 2],
    enabled,
    markdownOnly,
    promptOnly,
    minDepth: typeof source.minDepth === 'number' ? source.minDepth : null,
    maxDepth: typeof source.maxDepth === 'number' ? source.maxDepth : null,
  }
}

export function projectRegexScripts(raw: unknown): RegexScript[] {
  if (!Array.isArray(raw)) return []
  const projected: RegexScript[] = []
  let uid = 0
  for (const entry of raw) {
    const script = projectRegexScript(entry, uid)
    uid += 1
    if (script) projected.push(script)
  }
  return projected
}

/**
 * Protection shield (RP behavior): a pattern that itself contains no angle
 * brackets or code fences must never touch protected content — full HTML
 * documents, script/style blocks, fenced code, inline code, and any HTML
 * tag are shielded; only the plain-prose gaps between them are rewritten.
 * Patterns carrying `<`, `>` or ``` run raw (strippers opt in that way).
 */
const usesHtmlOrCodeSyntax = (pattern: string): boolean =>
  pattern.includes('<') || pattern.includes('>') || pattern.includes('```')

interface ProtectedRange {
  start: number
  end: number
}

const HTML_TAG_START = (text: string, index: number): boolean => {
  const next = text[index + 1]
  return next !== undefined && /[a-zA-Z/!]/.test(next)
}

const findBlockEnd = (text: string, from: number, openTag: string, closeTag: string): number => {
  const close = text.toLowerCase().indexOf(closeTag, from + openTag.length)
  return close === -1 ? text.length : close + closeTag.length
}

/** Scans protected ranges: full HTML documents, script/style/cot/think
 *  blocks, fenced code, inline code, and individual HTML tags. */
const collectProtectedRanges = (text: string): ProtectedRange[] => {
  const ranges: ProtectedRange[] = []
  const lower = text.toLowerCase()
  let index = 0
  while (index < text.length) {
    const fence = text.indexOf('```', index)
    const backtick = text.indexOf('`', index)
    const angle = text.indexOf('<', index)
    const candidates: Array<{ at: number; kind: 'fence' | 'code' | 'tag' }> = []
    if (fence !== -1) candidates.push({ at: fence, kind: 'fence' })
    if (backtick !== -1 && (fence === -1 || backtick < fence)) candidates.push({ at: backtick, kind: 'code' })
    if (angle !== -1 && HTML_TAG_START(text, angle)) candidates.push({ at: angle, kind: 'tag' })
    if (candidates.length === 0) break
    const nearest = candidates.reduce((a, b) => (a.at <= b.at ? a : b))
    if (nearest.kind === 'fence') {
      const close = text.indexOf('```', nearest.at + 3)
      const end = close === -1 ? text.length : close + 3
      ranges.push({ start: nearest.at, end })
      index = end
    } else if (nearest.kind === 'code') {
      const close = text.indexOf('`', nearest.at + 1)
      const end = close === -1 ? text.length : close + 1
      ranges.push({ start: nearest.at, end })
      index = end
    } else {
      // Block forms first (script/style/cot/think), then the bare tag.
      const blockOpens: Array<[string, string]> = [
        ['<script', '</script>'],
        ['<style', '</style>'],
        ['<cot', '</cot>'],
        ['<think', '</think>'],
      ]
      let handled = false
      for (const [openTag, closeTag] of blockOpens) {
        if (lower.startsWith(openTag, nearest.at)) {
          const end = findBlockEnd(text, nearest.at, openTag, closeTag)
          ranges.push({ start: nearest.at, end })
          index = end
          handled = true
          break
        }
      }
      if (handled) continue
      if (lower.startsWith('<!doctype html', nearest.at) || lower.startsWith('<html', nearest.at)) {
        const close = lower.indexOf('</html>', nearest.at)
        const end = close === -1 ? text.length : close + 7
        ranges.push({ start: nearest.at, end })
        index = end
        continue
      }
      const tagClose = text.indexOf('>', nearest.at)
      if (tagClose === -1) {
        index = text.length
        continue
      }
      ranges.push({ start: nearest.at, end: tagClose + 1 })
      index = tagClose + 1
    }
  }
  return ranges
}

const replaceUnprotected = (text: string, ranges: ProtectedRange[], transform: (segment: string) => string): string => {
  const segments: string[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push(transform(text.slice(cursor, range.start)))
    segments.push(text.slice(range.start, range.end))
    cursor = range.end
  }
  if (cursor < text.length) segments.push(transform(text.slice(cursor)))
  return segments.join('')
}

export interface RegexApplyOptions {
  scripts: readonly RegexScript[]
  surface: RegexSurface
  role: 'user' | 'assistant'
  depth: number
  /** Device-local per-script toggles (uid set). */
  disabledUids?: ReadonlySet<number>
}

/** Applies the active scripts in array order; a failing script is skipped
 *  (logged) and the pipeline continues with the previous output. */
export function applyRegexPipeline(text: string, options: RegexApplyOptions): string {
  let current = text
  for (const script of options.scripts) {
    if (options.disabledUids?.has(script.uid)) continue
    const rolePlacement = options.role === 'user' ? 1 : 2
    if (!script.placement.includes(rolePlacement)) continue
    if (options.surface === 'display' && script.promptOnly) continue
    if (options.surface === 'prompt' && !script.promptOnly) continue
    if (script.minDepth !== null && options.depth < script.minDepth) continue
    if (script.maxDepth !== null && options.depth > script.maxDepth) continue
    try {
      let flags = script.flags || 'g'
      if (!flags.includes('g')) flags += 'g'
      const matcher = new RegExp(script.pattern, flags)
      if (usesHtmlOrCodeSyntax(script.pattern)) {
        current = current.replace(matcher, script.replacement)
      } else {
        const matcherCopy = matcher
        current = replaceUnprotected(current, collectProtectedRanges(current), (segment) =>
          segment.replace(matcherCopy, script.replacement))
      }
    } catch (error) {
      console.warn(`[regex] script "${script.name || script.uid}" failed:`, error instanceof Error ? error.message : error)
    }
  }
  return current
}

/** Full-HTML-document detection for the prompt-side omission switch (D7):
 *  a floor that IS a frontend document is replaced by an omission marker in
 *  the request — the display path keeps rendering the real thing. */
export function isFullHtmlDocument(text: string): boolean {
  const trimmed = text.trim()
  const open = trimmed.match(/(<!doctype html>|<html\b[^>]*>)/i)
  if (!open || open.index === undefined) return false
  return trimmed.toLowerCase().lastIndexOf('</html>') > open.index
}

export const HTML_FLOOR_OMISSION_MARKER = '[前端界面楼层，内容已省略]'
