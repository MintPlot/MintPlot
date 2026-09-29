/**
 * Plugin manifest (ADR-001 §03, R-03) — the declaration half of the contract
 * trio. Ids are immutable after publication (storage prefixes, permission
 * domains and log attribution all anchor on the id); versions are semver and
 * the kernel checks API compatibility against them.
 *
 * MP addition (spec v1.2 §03/§06): `sessions` — the session-kind declaration.
 * Omitted = the plugin is domain-agnostic and applies to both chatbox and
 * card sessions; core plugins declare `['card']` (card-only mounting) in the
 * manifest and mirror it in code-level hook/filter options.
 */

import type { SessionKind } from './session-kind'
import { SESSION_KINDS } from './session-kind'
import { PIPELINE_POINTS, PUBLIC_SEAM_IDS } from './extension-points'
import { checkPermissions } from './permissions'
import type { PluginDefinition } from './lifecycle'

/** Reserved ids — no plugin may ever claim them. */
export const RESERVED_PLUGIN_IDS = ['kernel', 'mintplot'] as const

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Prerelease/build metadata allowed; three numeric segments required. */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Build-time chunk path relative to the plugin directory. */
const ENTRY_PATTERN = /^\.\/[\w./-]+$/

/** Build-time assembly declarations (ADR-001 §03 extensionPoints field). */
export interface PluginExtensionPoints {
  /** Capability seams this plugin provides implementations for. */
  provide?: readonly string[]
  /** Pipeline points this plugin subscribes hooks to. */
  hooks?: readonly string[]
  /** View ids this plugin registers. */
  views?: readonly string[]
  /** Settings page sections this plugin registers. */
  settings?: readonly SettingsDeclaration[]
  /** Input-dock action ids this plugin registers. */
  inputActions?: readonly InputActionDeclaration[]
  /** Host settings keys this plugin may read/write via ctx.settings.scope
   *  (ADR-004); scope() rejects undeclared keys at runtime. */
  settingsScope?: readonly string[]
}

export interface SettingsDeclaration {
  id: string
  title: string
}

export interface InputActionDeclaration {
  id: string
}

export interface PluginManifest {
  /** `^[a-z][a-z0-9-]*$`, repo-unique, immutable; see RESERVED_PLUGIN_IDS. */
  readonly id: string
  /** Semver; kernel checks API compatibility (pre-freeze: ADR-001 §12). */
  readonly version: string
  /** Entry module path, e.g. `./index.ts` (build-time chunk, R-13). */
  readonly entry: string
  /** eager only for chat-main-path dependencies (R-12); everything else lazy. */
  readonly activation: 'eager' | 'lazy'
  /** Session kinds this plugin mounts into; omitted = both domains. */
  readonly sessions?: readonly SessionKind[]
  /** Static declaration, default deny-all, user-visible (R-11). */
  readonly permissions: readonly string[]
  readonly extensionPoints?: PluginExtensionPoints
}

export interface ManifestError {
  /** Dotted path to the offending field, e.g. `permissions[2]`. */
  path: string
  message: string
}

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: ManifestError[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function error(path: string, message: string): ManifestError {
  return { path, message }
}

/**
 * Structural validation of an unknown manifest (as read from
 * `src/plugins/<id>/manifest.json` by the M2 build-time scan). Cross-checks
 * extension point declarations against the catalogs and against the declared
 * permissions, so a plugin cannot declare a hook it has no permission for.
 */
export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: ManifestError[] = []

  if (!isRecord(input)) {
    return { ok: false, errors: [error('', 'manifest must be a JSON object')] }
  }

  const id = input.id
  if (typeof id !== 'string' || id.length === 0) {
    errors.push(error('id', 'required'))
  } else if (!PLUGIN_ID_PATTERN.test(id)) {
    errors.push(error('id', `must match ${PLUGIN_ID_PATTERN.source}, got "${id}"`))
  } else if ((RESERVED_PLUGIN_IDS as readonly string[]).includes(id)) {
    errors.push(error('id', `"${id}" is reserved (kernel/mintplot)`))
  }

  if (typeof input.version !== 'string' || !SEMVER_PATTERN.test(input.version)) {
    errors.push(error('version', 'must be semver (x.y.z, optional prerelease/build)'))
  }

  if (typeof input.entry !== 'string' || !ENTRY_PATTERN.test(input.entry)) {
    errors.push(error('entry', 'must be a relative chunk path like "./index.ts"'))
  }

  if (input.activation !== 'eager' && input.activation !== 'lazy') {
    errors.push(error('activation', 'must be "eager" or "lazy"'))
  }

  const permissions: string[] = []
  if (input.permissions !== undefined) {
    if (!Array.isArray(input.permissions) || input.permissions.some((p) => typeof p !== 'string')) {
      errors.push(error('permissions', 'must be an array of permission id strings'))
    } else {
      permissions.push(...(input.permissions as string[]))
      for (const reason of checkPermissions(permissions)) {
        errors.push(error('permissions', reason))
      }
    }
  }

  let sessions: readonly SessionKind[] | undefined
  if (input.sessions !== undefined) {
    if (
      !Array.isArray(input.sessions) ||
      input.sessions.some((kind) => !(SESSION_KINDS as readonly string[]).includes(kind as string))
    ) {
      errors.push(error('sessions', `must be a subset of ${SESSION_KINDS.join(' | ')}`))
    } else {
      sessions = input.sessions as readonly SessionKind[]
    }
  }

  let extensionPoints: PluginExtensionPoints | undefined
  if (input.extensionPoints !== undefined) {
    if (!isRecord(input.extensionPoints)) {
      errors.push(error('extensionPoints', 'must be an object'))
    } else {
      extensionPoints = validateExtensionPoints(input.extensionPoints, permissions, errors)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const manifest: PluginManifest = {
    // Casts are sound: every field above was type-checked and any failure
    // already returned via the errors branch.
    id: id as string,
    version: input.version as string,
    entry: input.entry as string,
    activation: input.activation as 'eager' | 'lazy',
    permissions,
    ...(sessions !== undefined ? { sessions } : {}),
    ...(extensionPoints !== undefined ? { extensionPoints } : {}),
  }
  return { ok: true, manifest }
}

function validateStringList(
  container: Record<string, unknown>,
  field: string,
  path: string,
  allowed: readonly string[] | undefined,
  errors: ManifestError[],
): string[] {
  const value = container[field]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(error(path, 'must be an array of id strings'))
    return []
  }
  const list = value as string[]
  if (allowed !== undefined) {
    for (const item of list) {
      if (!allowed.includes(item)) {
        errors.push(error(`${path}[]`, `unknown id "${item}" (allowed: ${allowed.join(', ')})`))
      }
    }
  }
  return list
}

function validateExtensionPoints(
  raw: Record<string, unknown>,
  permissions: readonly string[],
  errors: ManifestError[],
): PluginExtensionPoints {
  const result: PluginExtensionPoints = {}

  const provide = validateStringList(raw, 'provide', 'extensionPoints.provide', PUBLIC_SEAM_IDS, errors)
  const hooks = validateStringList(raw, 'hooks', 'extensionPoints.hooks', PIPELINE_POINTS, errors)
  validateStringList(raw, 'views', 'extensionPoints.views', undefined, errors)

  if (raw.settings !== undefined) {
    if (
      !Array.isArray(raw.settings) ||
      raw.settings.some(
        (item) =>
          !isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string',
      )
    ) {
      errors.push(error('extensionPoints.settings', 'must be an array of { id, title }'))
    } else {
      result.settings = (raw.settings as SettingsDeclaration[]).map((item) => ({
        id: item.id,
        title: item.title,
      }))
    }
  }

  if (raw.inputActions !== undefined) {
    if (
      !Array.isArray(raw.inputActions) ||
      raw.inputActions.some((item) => !isRecord(item) || typeof item.id !== 'string')
    ) {
      errors.push(error('extensionPoints.inputActions', 'must be an array of { id }'))
    } else {
      result.inputActions = (raw.inputActions as InputActionDeclaration[]).map((item) => ({
        id: item.id,
      }))
    }
  }

  if (raw.settingsScope !== undefined) {
    if (
      !Array.isArray(raw.settingsScope) ||
      raw.settingsScope.some((item) => typeof item !== 'string' || item.length === 0)
    ) {
      errors.push(error('extensionPoints.settingsScope', 'must be an array of non-empty setting key strings'))
    } else {
      result.settingsScope = raw.settingsScope as string[]
    }
  }

  // Declaration ↔ permission consistency: a mounting declared without its
  // permission id would fail at runtime anyway; surface it at scan time.
  for (const seamId of provide) {
    if (!permissions.includes(`seam.provide.${seamId}`)) {
      errors.push(error('extensionPoints.provide', `"${seamId}" declared but "seam.provide.${seamId}" permission missing`))
    }
  }
  for (const point of hooks) {
    if (!permissions.includes(`hook.${point}`)) {
      errors.push(error('extensionPoints.hooks', `"${point}" declared but "hook.${point}" permission missing`))
    }
  }

  return result
}

/**
 * Typed passthrough for plugin entry modules (`src/plugins/<id>/index.ts`).
 * No runtime validation here — manifests are validated by
 * {@link validateManifest} at load; this helper exists for type inference and
 * a stable authoring shape.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition
}
