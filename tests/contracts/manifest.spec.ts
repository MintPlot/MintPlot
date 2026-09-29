import { describe, expect, it } from 'vitest'
import { RESERVED_PLUGIN_IDS, definePlugin, validateManifest } from '../../contracts/manifest'
import type { PluginDefinition } from '../../contracts/lifecycle'
import type { PluginContext } from '../../contracts/plugin-context'

/** ADR-001 appendix A: the TTS plugin manifest, verbatim shape (plus the M3-h display card). */
const ttsManifest = {
  id: 'tts',
  version: '1.0.0',
  entry: './index.ts',
  activation: 'lazy',
  display: { name: '语音朗读', description: '用语音引擎朗读角色回复' },
  permissions: [
    'seam.provide.tts.engine',
    'settings.section',
    'secrets.read.ttsCloudApiKey',
    'session.event.read',
  ],
  extensionPoints: {
    provide: ['tts.engine'],
    views: [],
    settings: [{ id: 'tts', title: '语音合成' }],
  },
}

describe('validateManifest', () => {
  it('accepts the ADR-001 appendix A manifest', () => {
    const result = validateManifest(ttsManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('tts')
    expect(result.manifest.activation).toBe('lazy')
    expect(result.manifest.permissions).toHaveLength(4)
    expect(result.manifest.extensionPoints?.settings).toEqual([{ id: 'tts', title: '语音合成' }])
  })

  it('normalizes an omitted permission list to deny-all', () => {
    // Strip the extension points too: provide declarations imply their
    // seam.provide.* permissions (declaration ↔ permission consistency).
    const result = validateManifest({ ...ttsManifest, permissions: undefined, extensionPoints: undefined })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.permissions).toEqual([])
  })

  it('rejects malformed plugin ids', () => {
    for (const id of ['TTS', '1tts', 'tt_s', 'tts engine', '', ' tts']) {
      const result = validateManifest({ ...ttsManifest, id })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors.some((e) => e.path === 'id')).toBe(true)
    }
  })

  it('rejects reserved ids (kernel / mintplot)', () => {
    for (const id of RESERVED_PLUGIN_IDS) {
      const result = validateManifest({ ...ttsManifest, id })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors.some((e) => e.message.includes('reserved'))).toBe(true)
    }
  })

  it('requires semver versions and accepts prerelease/build metadata', () => {
    for (const version of ['1.0', 'v1.0.0', 'alpha', '']) {
      const result = validateManifest({ ...ttsManifest, version })
      expect(result.ok).toBe(false)
    }
    expect(validateManifest({ ...ttsManifest, version: '1.2.3-beta.1+build.7' }).ok).toBe(true)
  })

  it('requires a relative chunk entry path', () => {
    for (const entry of ['index.ts', '/index.ts', 'http://cdn/tts.ts', '']) {
      const result = validateManifest({ ...ttsManifest, entry })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors.some((e) => e.path === 'entry')).toBe(true)
    }
  })

  it('rejects unknown activation values', () => {
    const result = validateManifest({ ...ttsManifest, activation: 'sometimes' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.path === 'activation')).toBe(true)
  })

  it('requires the display card with non-empty name and description (M3-h)', () => {
    const badDisplays: unknown[] = [undefined, {}, { name: '语音朗读' }, { name: '', description: 'x' }, { name: '语音朗读', description: '   ' }]
    for (const display of badDisplays) {
      const result = validateManifest({ ...ttsManifest, display })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors.some((e) => e.path === 'display')).toBe(true)
    }
    expect(validateManifest({ ...ttsManifest, display: { name: '语音朗读', description: '朗读' } }).ok).toBe(true)
  })

  it('category is optional and validated against the two-value catalog (M3-h)', () => {
    expect(validateManifest(ttsManifest).ok).toBe(true)
    expect(validateManifest({ ...ttsManifest, category: 'system' }).ok).toBe(true)
    expect(validateManifest({ ...ttsManifest, category: 'extension' }).ok).toBe(true)
    const bad = validateManifest({ ...ttsManifest, category: 'builtin' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.errors.some((e) => e.path === 'category')).toBe(true)
  })

  it('rejects unknown permission ids', () => {
    const result = validateManifest({ ...ttsManifest, permissions: ['kernel.sudo'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.path === 'permissions')).toBe(true)
  })

  it('accepts a card-only session declaration and rejects unknown kinds', () => {
    expect(validateManifest({ ...ttsManifest, sessions: ['card'] }).ok).toBe(true)
    const bad = validateManifest({ ...ttsManifest, sessions: ['roleplay'] })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.errors.some((e) => e.path === 'sessions')).toBe(true)
  })

  it('rejects extension point declarations naming unknown ids', () => {
    const badHook = validateManifest({
      ...ttsManifest,
      permissions: [...ttsManifest.permissions, 'hook.prompt.universe'],
      extensionPoints: { ...ttsManifest.extensionPoints, hooks: ['prompt.universe'] },
    })
    expect(badHook.ok).toBe(false)
    if (badHook.ok) return
    expect(badHook.errors.some((e) => e.path === 'extensionPoints.hooks[]')).toBe(true)

    const badSeam = validateManifest({
      ...ttsManifest,
      permissions: [...ttsManifest.permissions, 'seam.provide.turn.driver'],
      extensionPoints: { ...ttsManifest.extensionPoints, provide: ['turn.driver'] },
    })
    expect(badSeam.ok).toBe(false)
    if (badSeam.ok) return
    expect(badSeam.errors.some((e) => e.path === 'extensionPoints.provide[]')).toBe(true)
  })

  it('rejects declarations missing their permission twin', () => {
    const result = validateManifest({
      ...ttsManifest,
      permissions: ttsManifest.permissions.filter((p) => p !== 'seam.provide.tts.engine'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.message.includes('permission missing'))).toBe(true)
  })

  it('rejects malformed settings and input action declarations', () => {
    const badSettings = validateManifest({
      ...ttsManifest,
      extensionPoints: { settings: [{ title: 'no id' }] },
    })
    expect(badSettings.ok).toBe(false)
    if (badSettings.ok) return
    expect(badSettings.errors.some((e) => e.path === 'extensionPoints.settings')).toBe(true)

    const badActions = validateManifest({
      ...ttsManifest,
      extensionPoints: { inputActions: ['quick-note'] },
    })
    expect(badActions.ok).toBe(false)
  })

  it('rejects non-object manifests with a single root error', () => {
    for (const input of [null, 42, 'tts', []]) {
      const result = validateManifest(input)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors).toHaveLength(1)
    }
  })
})

describe('definePlugin', () => {
  it('is a typed passthrough for plugin entry modules', () => {
    const ctx = {} as PluginContext
    const validated = validateManifest(ttsManifest)
    if (!validated.ok) throw new Error('fixture manifest must validate')
    const definition: PluginDefinition = {
      manifest: validated.manifest,
      activate: () => {
        ctx.onDeactivate(() => undefined)
      },
    }
    expect(definePlugin(definition)).toBe(definition)
  })
})
