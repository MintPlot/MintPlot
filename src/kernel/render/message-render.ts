/**
 * Message rich-text rendering (M3-n, native) — the RP pipeline internalized
 * (reference: decoupled repo useTemplateRenderer.mjs; behavior source, not a
 * code port). Order matters, exactly as RP:
 *   1. macro substitution (display pass — see macros.ts),
 *   2. full-HTML-document detection → the document body runs inside a
 *      sandboxed executable frame; the text around it renders as markdown,
 *   3. block-level-HTML-leading content skips marked and sanitizes directly
 *      (keeps card layout/styles intact),
 *   4. otherwise marked (breaks, no indented code so indented HTML renders)
 *      → DOMPurify whitelist → safe HTML for v-html.
 * srcdoc iframes found mid-content are extracted before sanitization and
 * rebuilt as controlled executable frames (RP's sanitize-with-controlled-
 * srcdoc-frames). Inline on* handlers never survive — whitelisting them in the
 * main document would amount to executing model output as code.
 */

import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { LruCache, limits } from '@/kernel/runtime/runtime-policy'
import { createExecutableHtmlIframe } from '@/kernel/render/html-frame'
import { replaceCardMacros } from '@/kernel/render/macros'

// RP lesson: indented HTML (e.g. <details>/<summary> blocks) must not fall
// into indented-code fences — disable the indentation-based code tokenizer.
marked.use({
  breaks: true,
  tokenizer: {
    code: () => undefined,
  },
})

const renderCache = new LruCache<string, string>(limits.renderCache)
const frameDetectionCache = new LruCache<string, boolean>(limits.renderCache)

export const clearRenderCaches = (): void => {
  renderCache.clear()
  frameDetectionCache.clear()
}

export interface MessageRenderContext {
  charName: string
  userName: string
}

const CLEAN_CONFIG: Record<string, unknown> = {
  ADD_TAGS: ['details', 'summary', 'iframe', 'svg', 'path', 'g', 'circle', 'rect', 'defs', 'linearGradient', 'stop', 'style', 'div', 'span', 'button', 'input'],
  ADD_ATTR: ['style', 'open', 'srcdoc', 'sandbox', 'frameborder', 'allow', 'allowfullscreen', 'class', 'id', 'viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'stroke-linecap', 'stroke-linejoin', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color', 'stop-opacity', 'width', 'height', 'type', 'value', 'checked', 'data-slash'],
  FORCE_BODY: true,
}

const htmlBlockStartPattern =
  /^\s*<(!doctype|html|head|body|div|span|section|article|aside|header|footer|nav|main|form|fieldset|ul|ol|li|table|style|script|template|button|input|select|textarea|canvas|video|audio|figure|dialog|details|summary|img|svg|p|h[1-6]|hr|blockquote|pre|a)\b/i

const matchesHtmlBlockStart = (text: string): boolean => htmlBlockStartPattern.test(String(text || ''))

/** Extracts srcdoc iframes before sanitization, rebuilds them as executable
 *  frames after — their content belongs to the card sandbox, never to the
 *  main document. */
function sanitizeWithControlledSrcdocFrames(rawMarkup: string): string {
  const parser = new DOMParser()
  const sourceDoc = parser.parseFromString(String(rawMarkup || ''), 'text/html')
  const frameSources: Array<{ html: string }> = []

  sourceDoc.querySelectorAll('iframe[srcdoc]').forEach((sourceFrame) => {
    const frameIndex = frameSources.push({ html: sourceFrame.getAttribute('srcdoc') || '' }) - 1
    const placeholder = sourceDoc.createElement('div')
    placeholder.setAttribute('data-mp-srcdoc-frame', String(frameIndex))
    sourceFrame.replaceWith(placeholder)
  })

  // The HTML parser hoists leading metadata content (<style>…) into <head>;
  // RP's body-only serialization silently drops it. Prepend the head so
  // inline card styles survive (the DOMPurify whitelist unchanged — whatever
  // it forbids in the body is equally forbidden from the head).
  const rawHtml = (sourceDoc.head?.innerHTML ?? '') + sourceDoc.body.innerHTML

  const sanitized = DOMPurify.sanitize(rawHtml, {
    ...CLEAN_CONFIG,
    FORBID_TAGS: ['iframe'],
  })
  if (frameSources.length === 0) return sanitized

  const sanitizedDoc = parser.parseFromString(sanitized, 'text/html')
  sanitizedDoc.querySelectorAll('[data-mp-srcdoc-frame]').forEach((placeholder) => {
    const frameIndex = Number.parseInt(placeholder.getAttribute('data-mp-srcdoc-frame') ?? '', 10)
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameSources.length) {
      placeholder.remove()
      return
    }
    placeholder.replaceWith(createExecutableHtmlIframe(frameSources[frameIndex]!.html))
  })
  return sanitizedDoc.body.innerHTML
}

function renderMarkdownOnly(text: string): string {
  return sanitizeWithControlledSrcdocFrames(marked.parse(text, { async: false }))
}

function renderHtmlDocument(trimmed: string): string {
  const htmlMatch = trimmed.match(/(<!doctype html>|<html\b[^>]*>)/i)
  if (!htmlMatch) return renderMarkdownOnly(trimmed)
  const startIndex = htmlMatch.index!
  const closeIndex = trimmed.toLowerCase().lastIndexOf('</html>')

  let htmlContent: string
  let preText: string
  let postText: string
  if (closeIndex !== -1 && closeIndex > startIndex) {
    const endIndex = closeIndex + '</html>'.length
    htmlContent = trimmed.substring(startIndex, endIndex)
    preText = trimmed.substring(0, startIndex)
    postText = trimmed.substring(endIndex)
  } else {
    htmlContent = trimmed.substring(startIndex)
    preText = trimmed.substring(0, startIndex)
    postText = ''
  }

  let resultHtml = ''
  if (preText.trim()) resultHtml += renderMarkdownOnly(preText)
  const container = document.createElement('div')
  container.className = 'html-card-container'
  container.style.margin = '0'
  container.style.paddingBottom = '0'
  container.style.marginBottom = '-1px'
  container.appendChild(createExecutableHtmlIframe(htmlContent))
  resultHtml += container.outerHTML
  if (postText.trim()) resultHtml += renderMarkdownOnly(postText)
  return resultHtml
}

/** Wide-layout predicate: does this content run as an executable frame?
 *  Code-fenced html/xml blocks count too — the model often ships cards in
 *  fences; raw fences render as code boxes users cannot interact with. */
export function contentUsesHtmlFrame(text: string, cacheable = true): boolean {
  if (!text) return false
  if (cacheable && frameDetectionCache.has(text)) return frameDetectionCache.get(text)!

  const trimmed = String(text).trim()
  let usesFrame = false
  const codeFencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g
  let codeMatch: RegExpExecArray | null
  while ((codeMatch = codeFencePattern.exec(trimmed)) !== null) {
    const language = codeMatch[1] || ''
    if (/\b(html|xml)\b/i.test(language) || matchesHtmlBlockStart(codeMatch[2] || '')) {
      usesFrame = true
      break
    }
  }
  if (!usesFrame && !trimmed.includes('```')) {
    usesFrame = /(<!doctype html>|<html\b[^>]*>)/i.test(trimmed)
  }
  if (cacheable) frameDetectionCache.set(text, usesFrame)
  return usesFrame
}

/** Full display render for a chat floor: macros → markdown / HTML-card
 *  dispatch → sanitized HTML. Cached by content+context unless `cacheable`
 *  is false (streaming floors). */
export function renderMessageHtml(
  text: string,
  context: MessageRenderContext,
  cacheable = true,
): string {
  if (!text) return ''
  const processed = replaceCardMacros(text, context)
  const cacheKey = processed
  if (cacheable && renderCache.has(cacheKey)) return renderCache.get(cacheKey)!

  const trimmed = processed.trim()
  let result: string
  if (/(<!doctype html>|<html\b[^>]*>)/i.test(trimmed) && !trimmed.includes('```')) {
    result = renderHtmlDocument(trimmed)
  } else if (matchesHtmlBlockStart(trimmed) && !trimmed.includes('```')) {
    // Raw block-level HTML without a document wrapper: sanitize directly —
    // marked parsing would break card layout and styles.
    result = sanitizeWithControlledSrcdocFrames(processed)
  } else {
    result = renderMarkdownOnly(processed)
  }
  if (cacheable) renderCache.set(cacheKey, result)
  return result
}
