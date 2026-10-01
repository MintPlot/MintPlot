/**
 * Executable HTML card frames (M3-n, native) — the RP iframe sandbox,
 * internalized (reference: decoupled repo app.mjs createExecutableHtmlIframe +
 * utils.mjs buildExecutableHtmlDocument + handleExecutableFrameMessage;
 * behavior source, not a code port).
 *
 * The sandbox deliberately omits `allow-same-origin`: a srcdoc document
 * inherits the parent origin, and with allow-scripts that equals no isolation
 * at all — a card script could reach the secret channel, the Capacitor plugin
 * bridge and the whole chat library. Character cards are external inputs
 * circulating in the community, so this path stays sealed. Host↔card
 * communication is postMessage only (height reporting here; slash/focus ride
 * the same channel when card interactions land in M3-p).
 */

import jqueryUrl from 'jquery/dist/jquery.min.js?url'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { limits } from '@/kernel/runtime/runtime-policy'

export const EXECUTABLE_FRAME_CHANNEL = 'mp-executable-frame'

/** RP's sandbox verbatim: everything except same-origin/top-navigation/escape. */
const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation'

const RESET_STYLE = [
  'html,body{margin:0!important;padding:0!important;width:100%!important;height:auto!important;',
  'min-height:auto!important;word-wrap:break-word!important;box-sizing:border-box!important;overflow:hidden!important;}',
  '::-webkit-scrollbar{display:none;}*,*::before,*::after{box-sizing:inherit!important;}',
  'img,video,canvas,svg{max-width:100%!important;height:auto!important;}',
  'table{display:block!important;overflow-x:auto!important;max-width:100%!important;}',
  'pre{white-space:pre-wrap!important;word-wrap:break-word!important;max-width:100%!important;}',
].join('')

// A literal close-tag in a string could terminate the document if the bundle
// were ever inlined into HTML; compose it so the sequence never appears.
const SCRIPT_CLOSE = ['<', '/script>'].join('')

/** The in-card shim: a postMessage-only bridge to the host (opaque origin —
 *  window.parent DOM is unreachable), reporting content height through a
 *  ResizeObserver/rAF loop. `triggerSlash` is pre-wired for M3-p card
 *  interactions; until the host dispatches them it stays inert. */
const SHIM_SCRIPT = `
    <script>
        var MP_FRAME_CHANNEL = ${JSON.stringify(EXECUTABLE_FRAME_CHANNEL)};
        function postToHost(payload) {
            try {
                payload.source = MP_FRAME_CHANNEL;
                window.parent.postMessage(payload, '*');
            } catch (e) {}
        }
        window.triggerSlash = function(text) {
            if (!text) return;
            postToHost({ type: 'slash', command: String(text) });
        };
        window.addEventListener('error', function(e) {
            var m = e && (e.message || e.type);
            postToHost({ type: 'card-error', message: String(m || 'error').slice(0, 200) });
        });
        window.addEventListener('unhandledrejection', function(e) {
            var r = e && e.reason;
            var m = r && (r.message || r);
            postToHost({ type: 'card-error', message: String(m || 'rejection').slice(0, 200) });
        });
        var lastHeight = 0;
        function measureHeight() {
            var body = document.body;
            var html = document.documentElement;
            var value = 0;
            if (body) value = Math.max(value, body.scrollHeight, body.offsetHeight);
            if (html) value = Math.max(value, html.scrollHeight, html.offsetHeight);
            return value;
        }
        function updateHeight() {
            var value = measureHeight();
            if (value && Math.abs(value - lastHeight) > 1) {
                lastHeight = value;
                postToHost({ type: 'height', value: value });
            }
        }
        window.addEventListener('load', updateHeight);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function() { requestAnimationFrame(updateHeight); }).observe(document.documentElement);
        }
        setInterval(updateHeight, 1200);
    ${SCRIPT_CLOSE}
`

/** Wraps raw card HTML into the srcdoc document every executable frame runs. */
export function buildExecutableHtmlDocument(rawHtml: string): string {
  // Opaque-origin srcdoc documents have no reliable base for relative URLs —
  // absolutize the bundled jQuery asset against the host location.
  const absoluteJquery = typeof location !== 'undefined' && location.href
    ? new URL(jqueryUrl, location.href).href
    : jqueryUrl
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
    `<style>${RESET_STYLE}</style>`,
    `<script src="${absoluteJquery}" defer>${SCRIPT_CLOSE}`,
    SHIM_SCRIPT,
    '</head><body>',
    String(rawHtml ?? ''),
    '</body></html>',
  ].join('')
}

export function createExecutableHtmlIframe(rawHtml: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.className = 'w-full bg-white block executable-html-frame'
  iframe.style.height = 'auto'
  iframe.style.overflow = 'hidden'
  iframe.style.transition = 'height 0.2s ease-out'
  iframe.style.margin = '0'
  iframe.style.padding = '0'
  iframe.setAttribute('scrolling', 'no')
  iframe.setAttribute('sandbox', IFRAME_SANDBOX)
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture')
  iframe.srcdoc = buildExecutableHtmlDocument(rawHtml)
  return iframe
}

/** Auth = contentWindow reference comparison: only a frame really attached to
 *  this document is served; same-named messages from other windows are dropped. */
function findExecutableFrameByWindow(sourceWindow: Window | null): HTMLIFrameElement | null {
  if (!sourceWindow) return null
  const frames = document.querySelectorAll('iframe.executable-html-frame')
  for (const element of frames) {
    const frame = element as HTMLIFrameElement
    if (frame.contentWindow === sourceWindow) return frame
  }
  return null
}

let hostStarted = false

/** Idempotent: installs the postMessage listener that applies card-reported
 *  heights (capped by the runtime policy) and journals card-script errors
 *  (M3-err1, MP-CARD-001) into the error hub. Focus/slash payloads are
 *  ignored until card interactions land (M3-p). */
export function startExecutableFrameHost(): void {
  if (hostStarted || typeof window === 'undefined') return
  hostStarted = true
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { source?: unknown; type?: unknown; value?: unknown; message?: unknown } | null
    if (!data || typeof data !== 'object' || data.source !== EXECUTABLE_FRAME_CHANNEL) return
    // For window-sourced messages the reference is a Window; ports never own
    // our channel payloads (they cannot host a card document).
    const frame = findExecutableFrameByWindow(event.source as Window | null)
    if (!frame) return
    if (data.type === 'height') {
      const height = Number(data.value)
      if (!Number.isFinite(height) || height <= 0) return
      frame.style.height = `${Math.min(limits.frameMaxHeight, Math.round(height))}px`
      return
    }
    if (data.type === 'card-error') {
      errorHub.record({
        severity: 'error',
        category: 'card',
        action: 'script_error',
        code: 'MP-CARD-001',
        message: typeof data.message === 'string' ? data.message.slice(0, 200) : 'unknown card script error',
      })
    }
  })
}
