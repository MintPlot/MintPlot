/**
 * SAF file bridge (M4-g1, native) — chunked export/import through the
 * MpFiles shell bridge (com.mintplot.app.MpFilesPlugin), with a browser
 * fallback (blob download / file input) for plain-web runs. Same lazy probe
 * discipline as the platform secret channel: the shell presence is tested
 * per operation, never assumed.
 *
 * The bridge moves BYTES only; every envelope/policy decision lives in
 * backup-envelope / backup-service. Base64 chunking rides the bridge
 * (256 KB per call — the RP shell exportFile discipline internalized).
 */

export interface FileBridge {
  /** Persists bytes via SAF; resolves false when the user cancels the picker. */
  exportFile(fileName: string, mimeType: string, bytes: Uint8Array): Promise<boolean>
  /** Reads bytes via SAF; resolves null when the user cancels the picker. */
  importFile(mimeType?: string): Promise<Uint8Array | null>
}

interface MpFilesBridge {
  exportStart(call: { fileName: string; mimeType: string }): Promise<{ ready?: boolean; sessionId?: string }>
  exportWrite(call: { sessionId: string; chunk: string }): Promise<void>
  exportEnd(call: { sessionId: string }): Promise<{ saved?: boolean }>
  importOpen(call: { mimeType: string }): Promise<{ ready?: boolean; sessionId?: string; size?: number }>
  importRead(call: { sessionId: string }): Promise<{ eof?: boolean; chunk?: string }>
}

const EXPORT_CHUNK_BYTES = 256 * 1024

const resolveNativeBridge = (): MpFilesBridge | null => {
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins
  const bridge = plugins?.MpFiles
  return bridge && typeof bridge === 'object' ? (bridge as MpFilesBridge) : null
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const createNativeFileBridge = (bridge: MpFilesBridge): FileBridge => ({
  async exportFile(fileName, mimeType, bytes) {
    const opened = await bridge.exportStart({ fileName, mimeType })
    if (!opened.ready || !opened.sessionId) return false
    // Write failures reject out of here directly — the native side aborts and
    // closes its session, the section surfaces the error toast.
    for (let offset = 0; offset < bytes.length; offset += EXPORT_CHUNK_BYTES) {
      await bridge.exportWrite({ sessionId: opened.sessionId, chunk: bytesToBase64(bytes.subarray(offset, offset + EXPORT_CHUNK_BYTES)) })
    }
    const ended = await bridge.exportEnd({ sessionId: opened.sessionId })
    return ended.saved === true
  },

  async importFile(mimeType) {
    const opened = await bridge.importOpen({ mimeType: mimeType ?? '*/*' })
    if (!opened.ready || !opened.sessionId) return null
    const sessionId = opened.sessionId
    const parts: Uint8Array[] = []
    for (;;) {
      const read = await bridge.importRead({ sessionId })
      if (read.eof) break
      if (read.chunk) parts.push(base64ToBytes(read.chunk))
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      merged.set(part, offset)
      offset += part.length
    }
    return merged
  },
})

const createBrowserFileBridge = (): FileBridge => ({
  exportFile(fileName, _mimeType, bytes) {
    return new Promise((resolve) => {
      const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
        resolve(true)
      }, 0)
    })
  },

  importFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '*/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        void file.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)))
      }
      input.oncancel = () => resolve(null)
      input.click()
    })
  },
})

export const resolveFileBridge = (): FileBridge => {
  const native = resolveNativeBridge()
  return native ? createNativeFileBridge(native) : createBrowserFileBridge()
}
