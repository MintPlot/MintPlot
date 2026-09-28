/**
 * Permission model (ADR-001 §06, R-11) — default deny-all; declarations are
 * static, visible to the user at install/enable time (plugin page), and
 * enforced at runtime by the plugin runtime (M2): over-stepping calls throw
 * and land in diagnostics.
 *
 * `storage.own` is implicit (never declared): every plugin automatically owns
 * its `plug:<id>:` storage namespace. Revocation/quotas are runtime concerns.
 */

import { PIPELINE_POINTS, PUBLIC_SEAM_IDS, SESSION_EVENT_TYPES } from './extension-points'
import { CARD_PANEL_SECTION_PERMISSION } from './variables'

/**
 * Fixed permission ids (no parameter). `card.panel.section` is reserved for
 * the variables plugin — the surface exists in the contract from day one.
 */
export const STATIC_PERMISSIONS = [
  'view.register',
  'settings.section',
  'input.action',
  CARD_PANEL_SECTION_PERMISSION,
  'session.event.read',
  'iframe.embed',
] as const

export type StaticPermission = (typeof STATIC_PERMISSIONS)[number]

/** Prefixes of parameterized permissions; the suffix is validated below. */
export const PARAMETERIZED_PERMISSION_PREFIXES = [
  'hook.',
  'session.event.emit.',
  'seam.provide.',
  'secrets.read.',
] as const

export type PermissionCheck = { ok: true } | { ok: false; reason: string }

/**
 * Secret keys: identifier-shaped, camelCase allowed (ADR-001 appendix A loans
 * `secrets.read.ttsCloudApiKey`), dot/underscore/dash-separated scopes allowed.
 */
const SECRET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/

/**
 * Validate a single declared permission id against the catalogs. Unknown
 * static ids, malformed parameterized ids, or parameterized ids pointing at
 * non-existent points/events/seams are all rejections.
 */
export function checkPermission(id: string): PermissionCheck {
  if ((STATIC_PERMISSIONS as readonly string[]).includes(id)) return { ok: true }

  for (const prefix of PARAMETERIZED_PERMISSION_PREFIXES) {
    if (!id.startsWith(prefix)) continue
    const parameter = id.slice(prefix.length)
    if (parameter.length === 0) {
      return { ok: false, reason: `empty parameter: "${id}"` }
    }
    switch (prefix) {
      case 'hook.':
        if (!(PIPELINE_POINTS as readonly string[]).includes(parameter)) {
          return { ok: false, reason: `unknown pipeline point "${parameter}"` }
        }
        return { ok: true }
      case 'session.event.emit.':
        if (!(SESSION_EVENT_TYPES as readonly string[]).includes(parameter)) {
          return { ok: false, reason: `unknown session event type "${parameter}"` }
        }
        return { ok: true }
      case 'seam.provide.':
        if (!(PUBLIC_SEAM_IDS as readonly string[]).includes(parameter)) {
          return { ok: false, reason: `unknown public seam "${parameter}"` }
        }
        return { ok: true }
      case 'secrets.read.':
        if (!SECRET_KEY_PATTERN.test(parameter)) {
          return { ok: false, reason: `malformed secret key "${parameter}"` }
        }
        return { ok: true }
    }
  }

  return { ok: false, reason: `unknown permission "${id}"` }
}

/** Validate a manifest's permission list; returns one entry per rejection. */
export function checkPermissions(ids: readonly string[]): string[] {
  return ids
    .map((id) => ({ id, check: checkPermission(id) }))
    .filter((entry): entry is { id: string; check: { ok: false; reason: string } } => !entry.check.ok)
    .map((entry) => `${entry.id}: ${entry.check.reason}`)
}
