/**
 * UI template interpolation engine (M3-s, native) — the RP ui-template-engine
 * render surface internalized (behavior source, not a code port). Card
 * templates come in two shapes and both must work:
 *  - RP-style fragments interpolating scalar fields (`{{hp}}`, `{{#each bag}}`);
 *  - 蛊真人-style self-rendering documents that receive the WHOLE state tree as
 *    JSON through `{{this}}` inside a hidden element and build their own
 *    interactive UI with their own scripts (data intake is interpolation; the
 *    scripts run in the M3-n sandbox frame, fed by ChatSessionView).
 * Escaping mirrors RP exactly — community templates un-escape `&lt;`/`&amp;`
 * themselves before JSON.parse, so the escape shape is a wire format.
 */

/** Recursive render context for `{{#each}}` bodies (root/current/parent chain
 *  plus @index-style accessors and the `as` alias). */
export interface TemplateRenderContext {
  root: unknown
  current: unknown
  parentContext: TemplateRenderContext | null
  index: number
  key: string | number
  length: number
  alias: string
}

export interface TemplateScriptRisk {
  hasScript: boolean
  inlineHandlers: boolean
  hasIframe: boolean
  javascriptUri: boolean
  risky: boolean
}

const isTemplateObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const cloneTemplateValue = <T>(value: T): T =>
  value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T)

/** ```-fenced templates (models and card authors both ship them) unwrap first. */
export const stripTemplateCodeFence = (value: unknown): string => {
  const text = String(value ?? '').trim()
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\s*```$/)
  return (fenced ? fenced[1]! : text).trim()
}

/** `a['b']` / `a[0]` normalize to dot parts, whitespace parts drop. */
export const splitTemplatePath = (path: unknown): string[] =>
  String(path ?? '')
    .trim()
    .replace(/\[(?:'([^']+)'|"([^"]+)"|([^\]]+))\]/g, (_, single, double, bare) => `.${single ?? double ?? String(bare ?? '').trim()}`)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

const readDotPath = (source: unknown, parts: string[]): unknown =>
  parts.reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined
    return (acc as Record<string, unknown>)[key]
  }, source)

/** Bare path read: self-referential keys return the source itself (RP same),
 *  own-key fast path next, then dot walk. */
const readPathOn = (source: unknown, expression: string): unknown => {
  const normalized = String(expression ?? '').trim()
  if (!normalized || normalized === '.' || normalized === 'this') return source
  if (isTemplateObject(source) && Object.prototype.hasOwnProperty.call(source, normalized)) {
    return source[normalized]
  }
  return readDotPath(source, splitTemplatePath(normalized))
}

/** Expression resolution against the render context: @-accessors, root./../
 *  climbs, alias reads, current-item-first bare paths. */
export const readTemplateValue = (
  variables: unknown,
  expression: string,
  context: TemplateRenderContext | null,
): unknown => {
  const key = String(expression ?? '').trim()
  if (!key) return undefined
  if (context) {
    if (key === 'this' || key === '.') return context.current
    if (key === '@index') return context.index
    if (key === '@number') return context.index + 1
    if (key === '@first') return context.index === 0
    if (key === '@last') return context.index === context.length - 1
    if (key === '@key') return context.key
    if (key === 'root') return context.root
    if (key.startsWith('root.')) return readPathOn(context.root, key.slice(5))
    if (key.startsWith('../')) {
      let climbs = 0
      let remainder = key
      while (remainder.startsWith('../')) {
        remainder = remainder.slice(3)
        climbs += 1
      }
      let level: TemplateRenderContext | null = context
      while (climbs > 0 && level?.parentContext) {
        level = level.parentContext
        climbs -= 1
      }
      const base = climbs > 0 ? context.root : (level?.current ?? context.root)
      return remainder ? readPathOn(base, remainder) : base
    }
    if (context.alias && (key === context.alias || key.startsWith(`${context.alias}.`))) {
      return key === context.alias
        ? context.current
        : readPathOn(context.current, key.slice(context.alias.length + 1))
    }
    const localValue = readPathOn(context.current, key)
    if (localValue !== undefined) return localValue
  }
  return readPathOn(variables, key)
}

/** Stringify for interpolation: strings raw, objects as pretty JSON (the
 *  {{this}} whole-tree channel), everything else String()'d. */
const stringifyTemplateValue = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** HTML-escape the interpolated string — identical shape to RP's escaping
 *  (community templates reverse exactly these five entities before parsing
 *  the {{this}} JSON blob). */
export const escapeTemplateValue = (value: unknown): string =>
  stringifyTemplateValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const createRootContext = (variables: unknown): TemplateRenderContext => ({
  root: variables,
  current: variables,
  parentContext: null,
  index: 0,
  key: '',
  length: 1,
  alias: '',
})

const EACH_PATTERN = /\{\{\s*#each\s+([^\s}]+)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\}((?:(?!\{\{\s*#each\b)[\s\S])*?)\{\{\s*\/each\s*\}\}/g

const renderEachBlocks = (templateText: string, variables: unknown, context: TemplateRenderContext): string => {
  let output = String(templateText ?? '')
  for (let pass = 0; pass < 50; pass++) {
    let replaced = false
    output = output.replace(EACH_PATTERN, (_whole, path: string, alias: string | undefined, body: string) => {
      replaced = true
      const value = readTemplateValue(variables, path, context)
      const [itemTemplate, emptyTemplate = ''] = String(body ?? '').split(/\{\{\s*else\s*\}\}/i)
      const entries: Array<{ item: unknown; key: string | number; index: number }> = Array.isArray(value)
        ? value.map((item, index) => ({ item, key: index, index }))
        : isTemplateObject(value)
          ? Object.entries(value).map(([key, item], index) => ({ item, key, index }))
          : []
      if (entries.length === 0) {
        return renderTemplateString(emptyTemplate, variables, context)
      }
      return entries
        .map(({ item, key, index }) =>
          renderTemplateString(itemTemplate, variables, {
            root: context.root,
            current: item,
            parentContext: context,
            index,
            key,
            length: entries.length,
            alias: alias ?? '',
          }))
        .join('')
    })
    if (!replaced) break
  }
  return output
}

/** Render one template: `{{#each}}` expansion first, then `{{expression}}`
 *  substitution with HTML escaping. Block markers and the literal `else`
 *  survive untouched (they belong to an outer/unmatched construct). */
export const renderTemplateString = (
  templateText: unknown,
  variables: unknown = {},
  context: TemplateRenderContext | null = null,
): string => {
  const activeContext = context ?? createRootContext(variables)
  const withArrays = renderEachBlocks(String(templateText ?? ''), variables, activeContext)
  return withArrays.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, expression: string) => {
    const key = String(expression ?? '').trim()
    if (!key || key === 'else' || key.startsWith('#') || key.startsWith('/')) return whole
    return escapeTemplateValue(readTemplateValue(variables, key, activeContext))
  })
}

const INLINE_EVENT_NAMES = new Set([
  'click', 'change', 'input', 'load', 'error', 'focus', 'blur', 'submit', 'reset',
  'keyup', 'keydown', 'keypress', 'mouseover', 'mouseout', 'mousedown', 'mouseup',
  'dblclick', 'contextmenu', 'dragstart', 'dragend', 'drop', 'paste', 'copy', 'cut',
  'touchstart', 'touchend', 'touchmove', 'pointerdown', 'pointerup', 'pointermove',
  'wheel', 'scroll', 'resize', 'unload', 'beforeunload', 'animationend', 'transitionend',
  'toggle', 'message', 'popstate', 'hashchange', 'visibilitychange', 'online', 'offline',
])

/** 「含脚本」 risk detection: inline/external <script>, real event-handler
 *  attributes, <iframe>, javascript: URIs. A label only — panel frames run in
 *  the sandboxed iframe regardless; the warning stays honest about trust. */
export const analyzeTemplateScriptRisk = (htmlTemplate: unknown): TemplateScriptRisk => {
  const html = String(htmlTemplate ?? '')
  const risk: TemplateScriptRisk = {
    hasScript: false,
    inlineHandlers: false,
    hasIframe: false,
    javascriptUri: false,
    risky: false,
  }
  if (!html) return risk
  risk.hasScript = /<script\b/i.test(html)
  risk.hasIframe = /<iframe\b/i.test(html)
  risk.javascriptUri = /javascript\s*:/i.test(html)
  const handlerMatches = [...html.matchAll(/\son([a-z][a-z0-9]*)\s*=/gi)]
  risk.inlineHandlers = handlerMatches.some((match) => INLINE_EVENT_NAMES.has(String(match[1] ?? '').toLowerCase()))
  risk.risky = risk.hasScript || risk.inlineHandlers || risk.hasIframe || risk.javascriptUri
  return risk
}

export const hasTemplateScripts = (htmlTemplate: unknown): boolean =>
  analyzeTemplateScriptRisk(htmlTemplate).risky
