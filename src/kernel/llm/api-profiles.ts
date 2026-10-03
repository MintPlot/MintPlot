/**
 * API provider profiles (M4-b, useApiConfig organ absorption per ADR-004) —
 * the named provider catalogue, profile resolution, legacy-config migration,
 * model listing and connectivity probing. Pure state helpers plus two network
 * operations; the settings store stays the single source of truth.
 *
 * Storage shape (plan §2 D5): profiles ride `mp_settings.apiProfiles` as an
 * id-keyed object — the secret channel extracts each nested `apiKey` by
 * structural path, and an id-keyed map keeps those paths stable across
 * deletions (an array would shift indexes and cross-contaminate keys). The
 * legacy flat trio (`apiBaseUrl`/`apiKey`/`apiModel`) remains a read fallback
 * until migration rewrites it into a "default" profile.
 */

export interface ApiProviderPreset {
  readonly id: string
  readonly name: string
  readonly apiUrl: string
}

/** Named catalogue (D2: RP's five presets carried over verbatim). */
export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', apiUrl: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', apiUrl: 'https://openrouter.ai/api/v1' },
  { id: 'siliconflow', name: 'SiliconFlow', apiUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'bailian', name: '阿里百炼', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', name: '智谱', apiUrl: 'https://open.bigmodel.cn/api/paas/v4' },
]

export interface ApiProfileConfig {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

export type ApiProfileMap = Record<string, ApiProfileConfig>

export interface ApiConfigSnapshot {
  baseUrl: string
  apiKey: string
  model: string
}

export function normalizeProviderUrl(url: unknown): string {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function matchPresetByUrl(url: unknown): ApiProviderPreset | null {
  const current = normalizeProviderUrl(url)
  if (!current) return null
  for (const preset of API_PROVIDER_PRESETS) {
    if (normalizeProviderUrl(preset.apiUrl) === current) return preset
  }
  return null
}

function readProfileMap(value: unknown): ApiProfileMap {
  const profiles: ApiProfileMap = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return profiles
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    profiles[id] = {
      name: String(raw.name ?? ''),
      baseUrl: String(raw.baseUrl ?? ''),
      model: String(raw.model ?? ''),
      apiKey: String(raw.apiKey ?? ''),
    }
  }
  return profiles
}

/**
 * Resolution order (plan §3): the profile picked by `apiActiveProfileId`,
 * falling back to the first profile, then to the legacy flat trio. An existing
 * profile always wins over legacy keys even when its fields are empty —
 * configured() still gates on baseUrl+model downstream.
 */
export function resolveApiConfig(snapshot: Record<string, unknown>): ApiConfigSnapshot {
  const profiles = readProfileMap(snapshot.apiProfiles)
  const activeId = String(snapshot.apiActiveProfileId ?? '')
  const picked = (activeId && profiles[activeId]) || Object.values(profiles)[0]
  if (picked) {
    return { baseUrl: picked.baseUrl, apiKey: picked.apiKey, model: picked.model }
  }
  return {
    baseUrl: String(snapshot.apiBaseUrl ?? ''),
    apiKey: String(snapshot.apiKey ?? ''),
    model: String(snapshot.apiModel ?? ''),
  }
}

export interface MigratedProfiles {
  profiles: ApiProfileMap
  activeId: string
}

/**
 * One-time legacy → profile migration: present only when profiles are absent
 * and the legacy trio carries a usable baseUrl. The migrated profile keeps
 * the matched preset's name when the URL is recognizable, else「默认」.
 */
export function migrateLegacyApiConfig(snapshot: Record<string, unknown>): MigratedProfiles | null {
  if (snapshot.apiProfiles && typeof snapshot.apiProfiles === 'object') return null
  const baseUrl = String(snapshot.apiBaseUrl ?? '').trim()
  const model = String(snapshot.apiModel ?? '').trim()
  if (!baseUrl || !model) return null
  const preset = matchPresetByUrl(baseUrl)
  return {
    profiles: {
      default: {
        name: preset ? preset.name : '默认',
        baseUrl,
        model,
        apiKey: String(snapshot.apiKey ?? ''),
      },
    },
    activeId: 'default',
  }
}

function modelsEndpoint(baseUrl: string): string {
  const base = normalizeProviderUrl(baseUrl)
  if (!base) throw new Error('API Base URL 为空')
  return `${base}/models`
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/** GET /models → model id list (tolerates `{data:[…]}` and bare arrays). */
export async function fetchModelList(config: { baseUrl: string; apiKey: string }, timeoutMs = 15000): Promise<string[]> {
  const response = await fetch(modelsEndpoint(config.baseUrl), {
    headers: authHeaders(config.apiKey),
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload: unknown = await response.json()
  const list = Array.isArray(payload) ? payload : (payload as { data?: unknown[] } | null)?.data
  if (!Array.isArray(list)) throw new Error('响应缺少模型列表')
  const ids: string[] = []
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : String((entry as { id?: unknown } | null)?.id ?? '')
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export interface ConnectivityResult {
  ok: boolean
  latencyMs: number
  error?: string
}

/** One GET /models round-trip with latency measurement (plan §2 D4). */
export async function checkProfileConnectivity(
  config: { baseUrl: string; apiKey: string },
  timeoutMs = 8000,
): Promise<ConnectivityResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(modelsEndpoint(config.baseUrl), {
      headers: authHeaders(config.apiKey),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    })
    return { ok: response.ok, latencyMs: Date.now() - startedAt, error: response.ok ? undefined : `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Fresh profile id — time+random, stable once written. */
export function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
