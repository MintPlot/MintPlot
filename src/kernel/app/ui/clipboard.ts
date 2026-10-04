/**
 * 剪贴板工具(M3 修复):Android WebView 里 navigator.clipboard 经常未实现或
 * 被权限策略拒绝(用户看到「复制失败:剪贴板不可用」),因此按可靠性降级:
 *   1. Capacitor 原生剪贴板(真机上最可靠);
 *   2. Web Clipboard API(桌面 / 安全上下文);
 *   3. execCommand('copy') 兜底(用户手势窗口内同步执行,WebView 有效)。
 * 返回是否成功,由调用方负责提示文案。
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
      /* 原生剪贴板失败,继续降级 */
    }
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* Web Clipboard 失败,继续降级 */
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
