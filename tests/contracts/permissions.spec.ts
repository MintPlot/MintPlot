import { describe, expect, it } from 'vitest'
import {
  STATIC_PERMISSIONS,
  checkPermission,
  checkPermissions,
} from '../../contracts/permissions'
import { SESSION_EVENT_TYPES } from '../../contracts/extension-points'
import { PIPELINE_POINTS, PUBLIC_SEAM_IDS } from '../../contracts/extension-points'

describe('checkPermission', () => {
  it('accepts every static permission id', () => {
    for (const id of STATIC_PERMISSIONS) {
      expect(checkPermission(id)).toEqual({ ok: true })
    }
  })

  it('rejects the implicit storage.own — never declarable', () => {
    const result = checkPermission('storage.own')
    expect(result.ok).toBe(false)
  })

  it('resolves hook permissions against the pipeline point catalog', () => {
    expect(checkPermission('hook.prompt.worldinfo')).toEqual({ ok: true })
    expect(checkPermission('hook.chat.render')).toEqual({ ok: true })
    expect(checkPermission('hook.prompt.universe').ok).toBe(false)
    expect(checkPermission('hook.').ok).toBe(false)
  })

  it('resolves emit permissions against the session event catalog', () => {
    for (const type of SESSION_EVENT_TYPES) {
      expect(checkPermission(`session.event.emit.${type}`)).toEqual({ ok: true })
    }
    expect(checkPermission('session.event.emit.floor.rewritten').ok).toBe(false)
  })

  it('resolves seam permissions against the public seam catalog only', () => {
    for (const seam of PUBLIC_SEAM_IDS) {
      expect(checkPermission(`seam.provide.${seam}`)).toEqual({ ok: true })
    }
    // Internal seams are deliberately outside contract v1 (R-09).
    expect(checkPermission('seam.provide.turn.driver').ok).toBe(false)
    expect(checkPermission('seam.provide.embedder').ok).toBe(false)
  })

  it('accepts identifier-shaped secret keys (camelCase per ADR appendix A)', () => {
    expect(checkPermission('secrets.read.ttsCloudApiKey')).toEqual({ ok: true })
    expect(checkPermission('secrets.read.image_gen_key')).toEqual({ ok: true })
    expect(checkPermission('secrets.read.9bad').ok).toBe(false)
    expect(checkPermission('secrets.read.').ok).toBe(false)
  })

  it('rejects unknown permission ids with a reason', () => {
    const result = checkPermission('kernel.sudo')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('kernel.sudo')
  })
})

describe('checkPermissions', () => {
  it('returns an empty list for a fully valid declaration', () => {
    expect(
      checkPermissions(['view.register', 'hook.prompt.memory', 'secrets.read.ApiKey']),
    ).toEqual([])
  })

  it('collects one message per rejection', () => {
    const reasons = checkPermissions(['bogus.permission', 'hook.nope', 'seam.provide.embedder'])
    expect(reasons).toHaveLength(3)
  })
})

describe('catalog cross-references', () => {
  it('keeps PIPELINE_POINTS and SESSION_EVENT_TYPES importable from one module', () => {
    // Permissions resolve against these; a split import surface would be a
    // truth-source smell. Single module, both catalogs.
    expect(PIPELINE_POINTS.length).toBeGreaterThan(0)
    expect(SESSION_EVENT_TYPES.length).toBeGreaterThan(0)
  })
})
