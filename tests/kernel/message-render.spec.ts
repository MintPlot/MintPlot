import { describe, expect, it } from 'vitest'
import { replaceCardMacros } from '@/kernel/render/macros'
import {
  clearRenderCaches,
  contentUsesHtmlFrame,
  renderMessageHtml,
} from '@/kernel/render/message-render'
import {
  buildExecutableHtmlDocument,
  createExecutableHtmlIframe,
  EXECUTABLE_FRAME_CHANNEL,
} from '@/kernel/render/html-frame'
import { executableFrameLifecycle } from '@/kernel/render/html-frame-lifecycle'

const CONTEXT = { charName: '星澜', userName: '旅人' }

describe('kernel/render · card macros (M3-n)', () => {
  it('replaces {{char}} and {{user}} case-insensitively, both at once', () => {
    expect(replaceCardMacros('{{CHAR}}看向{{user}}', CONTEXT)).toBe('星澜看向旅人')
    expect(replaceCardMacros('{{Char}}{{User}}', CONTEXT)).toBe('星澜旅人')
  })

  it('keeps the {{char}} literal when the domain has no char (chatbox)', () => {
    expect(replaceCardMacros('{{char}}问{{user}}好', { charName: '', userName: '旅人' })).toBe('{{char}}问旅人好')
  })

  it('passes text through untouched when nothing matches', () => {
    expect(replaceCardMacros('plain text', CONTEXT)).toBe('plain text')
    expect(replaceCardMacros('', CONTEXT)).toBe('')
  })
})

describe('kernel/render · html frame detection (M3-n)', () => {
  it('detects full HTML documents at any position', () => {
    expect(contentUsesHtmlFrame('<!DOCTYPE html><html><body>x</body></html>')).toBe(true)
    expect(contentUsesHtmlFrame('开场白\n<!doctype html><html>…')).toBe(true)
    expect(contentUsesHtmlFrame('<html lang="zh">…')).toBe(true)
  })

  it('detects html/xml code fences the model may ship cards in', () => {
    expect(contentUsesHtmlFrame('看:\n```html\n<div>x</div>\n```')).toBe(true)
    expect(contentUsesHtmlFrame('```\n<!doctype html>\n```')).toBe(true)
  })

  it('plain markdown and non-html fences stay false', () => {
    expect(contentUsesHtmlFrame('**bold** and _text_')).toBe(false)
    expect(contentUsesHtmlFrame('```js\nconst a = "<html>";\n```')).toBe(false)
    expect(contentUsesHtmlFrame('')).toBe(false)
  })
})

describe('kernel/render · message render (M3-n)', () => {
  it('renders markdown with breaks and inline emphasis', () => {
    const html = renderMessageHtml('第一行\n第二行 **加粗**', CONTEXT)
    expect(html).toContain('<br>')
    expect(html).toContain('<strong>加粗</strong>')
  })

  it('never lets on* handlers or scripts into the main document', () => {
    const html = renderMessageHtml('<div onclick="steal()">x</div><script>bad()</script><img src="x" onerror="y()">', CONTEXT)
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).toContain('x')
  })

  it('keeps whitelisted rich content: style, details/summary, svg basics', () => {
    const html = renderMessageHtml('<style>.a{color:red}</style><details open><summary>菜单</summary><b>内</b></details>', CONTEXT)
    expect(html).toContain('<style>')
    expect(html).toContain('<details open')
    expect(html).toContain('<summary>菜单</summary>')
  })

  it('routes full HTML documents into a sandboxed executable frame', () => {
    const greeting = '群广告行\n<!DOCTYPE html><html><head><style>p{color:red}</style></head><body><p>图鉴</p></body></html>'
    const html = renderMessageHtml(greeting, CONTEXT)
    // The raw document must exist only inside the rebuilt frame's srcdoc —
    // never as loose markup ahead of it.
    expect(html.indexOf('<iframe')).toBeGreaterThan(-1)
    expect(html.indexOf('<!DOCTYPE html>')).toBeGreaterThan(html.indexOf('<iframe'))
    expect(html).toContain('executable-html-frame')
    const sandbox = html.match(/sandbox="([^"]+)"/)?.[1] ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(html).toContain('群广告行')
  })

  it('renders raw block-level HTML without a document wrapper as sanitized HTML (no <p> mangling)', () => {
    const html = renderMessageHtml('<div class="panel"><span>面板</span></div>', CONTEXT)
    expect(html).toContain('<div class="panel">')
    expect(html).not.toContain('<p>&lt;div')
  })

  it('resolves macros before rendering', () => {
    const html = renderMessageHtml('{{char}}向{{user}}点头', CONTEXT)
    expect(html).toContain('星澜')
    expect(html).toContain('旅人')
    expect(html).not.toContain('{{user}}')
  })

  it('rebuilds embedded srcdoc iframes as controlled executable frames', () => {
    const html = renderMessageHtml('<iframe srcdoc="<b>嵌套卡</b>"></iframe>', CONTEXT)
    expect(html).toContain('executable-html-frame')
    expect(html).toContain('嵌套卡')
    expect(html.match(/<iframe/g)?.length).toBe(1)
  })

  it('cacheable=false (streaming) always re-renders fresh content', () => {
    clearRenderCaches()
    const first = renderMessageHtml('流式甲', CONTEXT, false)
    const second = renderMessageHtml('流式甲乙', CONTEXT, false)
    expect(first).toContain('甲')
    expect(second).toContain('甲乙')
  })
})

describe('kernel/render · executable frame sandbox (M3-n)', () => {
  it('wraps card HTML with viewport, reset style, jQuery and the postMessage shim', () => {
    const doc = buildExecutableHtmlDocument('<p>卡体</p>')
    expect(doc).toContain('<meta name="viewport"')
    expect(doc).toContain('overflow:hidden!important')
    expect(doc).toContain('jquery.min.js')
    expect(doc).toContain(EXECUTABLE_FRAME_CHANNEL)
    expect(doc).toContain('triggerSlash')
    expect(doc).toContain('ResizeObserver')
    expect(doc).toContain('<p>卡体</p>')
  })

  it('creates an iframe sandboxed without allow-same-origin', () => {
    const frame = createExecutableHtmlIframe('<b>x</b>')
    const sandbox = frame.getAttribute('sandbox') ?? ''
    expect(frame.className).toContain('executable-html-frame')
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(frame.srcdoc).toContain(EXECUTABLE_FRAME_CHANNEL)
  })

  it('lifecycle limiter exposes the runtime-policy red line', () => {
    expect(executableFrameLifecycle.maxActiveFrames).toBe(3)
    expect(executableFrameLifecycle.getActiveCount()).toBe(0)
  })
})
