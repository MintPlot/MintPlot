/**
 * Clipboard helper — in the Android WebView navigator.clipboard is often
 * missing or denied by the permissions policy (users saw the copy-failure
 * toast), so writes fall through by reliability:
 *   1. Capacitor native clipboard (most reliable on device);
 *   2. Web Clipboard API (desktop / secure contexts);
 *   3. execCommand('copy') last resort (synchronous inside the user-gesture
 *      window, works in the WebView).
 * Returns whether the write succeeded; callers own the toast copy.
 */
import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  if (Capacitor.isNativePlatform()) {
    try {
      await Clipboard.write({ string: text })
      return true
    } catch {
      // Native clipboard failed — fall through to the Web API.
    }
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Web Clipboard failed — fall through to execCommand.
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const succeeded = document.execCommand('copy')
    textarea.remove()
    return succeeded
  } catch {
    return false
  }
}
