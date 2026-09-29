/**
 * Update-checker service — ported from RP `src/modules/update-checker.mjs`
 * (baseline 4fedffd, 2026-09-29), typed and renamed per the porting pipeline
 * (§04 mapping: RP/Hub identifiers → MP). Pure logic, no kernel imports: it
 * runs against the ctx surfaces handed over by the plugin entry.
 *
 * MP adaptations (kept minimal, recorded in the port commit):
 *  - constants re-target the MP release channel (MintPlot/MintPlot);
 *  - the activity-journal hook resolves `window.MPRequestDiagnostics`
 *    (diagnostics seam lands with the M3 kernel pipeline — no-op until then);
 *  - compareVersions tolerates pre-release segments ("1.0.0-alpha"), which
 *    RP never needed (its versionName was numeric-only): a pre-release
 *    segment compares by its numeric prefix and sorts below the same number
 *    without one. Without this, MP's pinned versionName would always read
 *    as "up to date".
 */

export const MP_GITHUB_REPO = 'MintPlot/MintPlot'
export const MP_RELEASES_PAGE_URL = `https://github.com/${MP_GITHUB_REPO}/releases/latest`
const API_URL = `https://api.github.com/repos/${MP_GITHUB_REPO}/releases/latest`
const DOWNLOAD_TIMEOUT_MS = 120000
const MIN_APK_SIZE = 5 * 1024 * 1024

export interface MpReleaseInfo {
  tag_name: string
  html_url: string
  body: string
}

export interface MpUpdateCheckResult {
  hasUpdate: boolean
  release: MpReleaseInfo | null
  error: string | null
}

export interface MpDownloadResult {
  data: Uint8Array | null
  tag: string | null
  error: string | null
}

/**
 * Activity-journal seam: wraps check/download in lightweight records when the
 * diagnostics module is present (lazy lookup with a no-op fallback, ported
 * from RP so the module still loads in scopes without diagnostics).
 */
function activityBegin(category: string, action: string): {
  input: (entry: Record<string, unknown>) => void
  behavior: (entry: Record<string, unknown>) => void
  output: (entry: Record<string, unknown>) => void
  complete: () => void
  fail: (error: unknown) => void
} {
  try {
    const D = (globalThis as Record<string, unknown>).MPRequestDiagnostics as
      | { begin?: (args: { category: string; action: string }) => JournalRecord | undefined }
      | undefined
    const record = D?.begin?.({ category, action })
    if (record) return record
  } catch {
    // no-op
  }
  return {
    input: () => {},
    behavior: () => {},
    output: () => {},
    complete: () => {},
    fail: () => {},
  }
}

interface JournalRecord {
  input: (entry: Record<string, unknown>) => void
  behavior: (entry: Record<string, unknown>) => void
  output: (entry: Record<string, unknown>) => void
  complete: () => void
  fail: (error: unknown) => void
}

export function compareVersions(a: string, b: string): 1 | 0 | -1 {
  const partsA = String(a).split('.')
  const partsB = String(b).split('.')
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    // Pre-release tolerance (MP adaptation): compare the numeric prefix of
    // each segment; "1.0.0-alpha" counts as 1.0.0 but sorts below 1.0.0.
    const rawA = partsA[i] ?? '0'
    const rawB = partsB[i] ?? '0'
    const preA = rawA.includes('-')
    const preB = rawB.includes('-')
    const numA = Number(rawA.split('-')[0]) || 0
    const numB = Number(rawB.split('-')[0]) || 0
    if (numA > numB) return 1
    if (numA < numB) return -1
    if (!preA && preB) return 1
    if (preA && !preB) return -1
  }
  return 0
}

export async function fetchLatestRelease(): Promise<MpReleaseInfo | null> {
  try {
    const response = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { tag_name?: string; html_url?: string; body?: string }
    return {
      tag_name: data.tag_name || '',
      html_url: data.html_url || MP_RELEASES_PAGE_URL,
      body: data.body || '',
    }
  } catch {
    return null
  }
}

export async function checkForUpdate(currentVersion: string): Promise<MpUpdateCheckResult> {
  const journal = activityBegin('update', 'check')
  journal.input({
    kind: 'current_version',
    chars: String(currentVersion || '').length,
    summary: `current v${String(currentVersion || '')}`,
  })
  try {
    const release = await fetchLatestRelease()
    if (!release || !release.tag_name) {
      journal.behavior({ name: 'fetch_latest_release', result: 'failed', summary: 'Unable to fetch release info' })
      const errorResult: MpUpdateCheckResult = { hasUpdate: false, release: null, error: 'Unable to fetch release info' }
      journal.fail(new Error(errorResult.error ?? 'unknown'))
      return errorResult
    }
    const latestVersion = release.tag_name.replace(/^v/i, '')
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    journal.behavior({
      name: 'compare_versions',
      result: hasUpdate ? 'ok' : 'skipped',
      meta: { currentVersion: String(currentVersion || ''), latestVersion, hasUpdate },
    })
    journal.output({ contentChars: release.body.length })
    journal.complete()
    return { hasUpdate, release, error: null }
  } catch (err) {
    journal.fail(err)
    throw err
  }
}

export async function downloadApk(progressCallback?: (fraction: number) => void): Promise<MpDownloadResult> {
  const journal = activityBegin('update', 'download_apk')
  try {
    const release = await fetchLatestRelease()
    if (!release || !release.tag_name) {
      journal.fail(new Error('Cannot fetch release info'))
      return { data: null, tag: null, error: 'Cannot fetch release info' }
    }

    const tag = release.tag_name.replace(/^v/i, '')
    const downloadUrl = `https://github.com/${MP_GITHUB_REPO}/releases/download/v${tag}/MintPlot-${tag}-release.apk`
    journal.input({ kind: 'release_download', summary: `v${tag}` })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

    try {
      const response = await fetch(downloadUrl, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) {
        const hint = response.status === 404 ? 'APK not found for this version' : `HTTP ${response.status}`
        journal.fail(new Error(hint))
        return { data: null, tag: null, error: hint }
      }
      const contentLength = Number(response.headers.get('Content-Length')) || 0
      journal.behavior({ name: 'download_started', result: 'ok', meta: { expectedBytes: contentLength } })
      if (contentLength > 0 && contentLength < MIN_APK_SIZE) {
        const small = { error: `Server response too small (${Math.round(contentLength / 1024)}KB), aborting` }
        journal.fail(new Error(small.error))
        return { data: null, tag: null, error: small.error }
      }

      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let receivedLength = 0

      for (;;) {
        const result = await reader.read()
        if (result.done) break
        chunks.push(result.value)
        receivedLength += result.value.length
        if (progressCallback && contentLength) {
          progressCallback(receivedLength / contentLength)
        }
      }

      if (contentLength > 0 && receivedLength !== contentLength) {
        const incomplete = { error: `Download incomplete: ${Math.round(receivedLength / 1024)}KB of ${Math.round(contentLength / 1024)}KB` }
        journal.fail(new Error(incomplete.error))
        return { data: null, tag: null, error: incomplete.error }
      }
      if (receivedLength < MIN_APK_SIZE) {
        const tiny = { error: `Downloaded file too small (${Math.round(receivedLength / 1024)}KB)` }
        journal.fail(new Error(tiny.error))
        return { data: null, tag: null, error: tiny.error }
      }

      const allChunks = new Uint8Array(receivedLength)
      let position = 0
      for (const chunk of chunks) {
        allChunks.set(chunk, position)
        position += chunk.length
      }
      journal.behavior({ name: 'download_finished', result: 'ok', meta: { receivedBytes: receivedLength } })
      journal.output({ totalChars: 0 }) // no "chars" for binary
      journal.complete()
      return { data: allChunks, tag, error: null }
    } catch (e) {
      clearTimeout(timeoutId)
      journal.fail(e)
      if (e instanceof Error && e.name === 'AbortError') {
        return { data: null, tag: null, error: `Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s` }
      }
      return { data: null, tag: null, error: `Download failed: ${(e instanceof Error && e.message) || 'unknown error'}` }
    }
  } catch (outer) {
    journal.fail(outer)
    return { data: null, tag: null, error: `Release info fetch failed: ${String((outer instanceof Error && outer.message) || outer || 'unknown error')}` }
  }
}

/** Chunked base64: multi-MB APKs must not build one huge string per byte. */
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < buffer.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, buffer.subarray(i, Math.min(i + chunkSize, buffer.length)) as unknown as number[])
  }
  return btoa(binary)
}

interface MpCapacitorFilesystem {
  readdir(args: { path: string; directory: string }): Promise<{ files?: { name?: string }[] }>
  deleteFile(args: { path: string; directory: string }): Promise<void>
  writeFile(args: { path: string; data: string; directory: string }): Promise<{ uri?: string }>
  getUri(args: { path: string; directory: string }): Promise<{ uri: string }>
}

interface MpCapacitorNativeStorage {
  installApk(args: { filePath: string }): Promise<void>
}

function capacitorPlugins(): { Filesystem?: MpCapacitorFilesystem; NativeStorage?: MpCapacitorNativeStorage } | null {
  const plugins = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins
  return (plugins ?? null) as { Filesystem?: MpCapacitorFilesystem; NativeStorage?: MpCapacitorNativeStorage } | null
}

async function cleanOldApkFiles(Filesystem: MpCapacitorFilesystem): Promise<void> {
  try {
    const result = await Filesystem.readdir({ path: '', directory: 'CACHE' })
    for (const file of result.files ?? []) {
      if (file.name && file.name.startsWith('MintPlot-') && file.name.includes('-release.apk')) {
        await Filesystem.deleteFile({ path: file.name, directory: 'CACHE' })
      }
    }
  } catch {
    // Silently ignore cleanup errors
  }
}

export async function saveAndInstallApk(bytes: Uint8Array, tag: string): Promise<{ error: string | null }> {
  const plugins = capacitorPlugins()
  const Filesystem = plugins?.Filesystem
  const NativeStorage = plugins?.NativeStorage
  if (!Filesystem || !NativeStorage) return { error: 'Required plugins not available' }

  const b64 = arrayBufferToBase64(bytes)
  const fileName = `MintPlot-${tag}-release.apk`

  try {
    // Clean up any stale APK files before writing the new one
    await cleanOldApkFiles(Filesystem)

    const result = await Filesystem.writeFile({ path: fileName, data: b64, directory: 'CACHE' })
    let filePath = result.uri
    if (!filePath) {
      const uriResult = await Filesystem.getUri({ path: fileName, directory: 'CACHE' })
      filePath = uriResult.uri
    }
    await NativeStorage.installApk({ filePath })
    return { error: null }
  } catch (e) {
    // Clean up the partial file on failure
    try {
      await Filesystem.deleteFile({ path: fileName, directory: 'CACHE' })
    } catch {
      // cleanup failure after a failed install is non-actionable
    }
    return { error: `Installation failed: ${(e instanceof Error && e.message) || 'unknown error'}` }
  }
}
