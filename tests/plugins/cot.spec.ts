import { describe, expect, it } from 'vitest'
import { validateManifest } from '@contracts'
import type { PluginManifest } from '@contracts'
import CotPlugin from '@/plugins/cot'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import { makeServices } from './variables.spec'

describe('cot · manifest (M4-f)', () => {
  it('validates: both domains (sessions omitted), no permissions, display card present', () => {
    const result = validateManifest(CotPlugin.manifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const manifest = result.manifest as PluginManifest
    expect(manifest.id).toBe('cot')
    expect(manifest.activation).toBe('lazy')
    // sessions omitted = both chat domains (M3-q2 default semantics) —
    // thinking serves the chatbox domain just as much as the card domain.
    expect(manifest.sessions).toBeUndefined()
    expect(manifest.permissions).toEqual([])
    expect(manifest.display).toEqual({
      name: '思维链',
      description: expect.stringContaining('思考'),
    })
  })
})

describe('cot · runtime lifecycle (M4-f)', () => {
  it('loads bundled (system category) and toggles registered ↔ active', async () => {
    const runtime = createPluginRuntime(makeServices())
    runtime.load(CotPlugin)

    const before = runtime.projection().find((entry) => entry.id === 'cot')
    expect(before).toMatchObject({ state: 'registered', category: 'system' })

    await runtime.activate('cot')
    expect(runtime.stateOf('cot')).toBe('active')

    await runtime.deactivate('cot')
    expect(runtime.stateOf('cot')).toBe('registered')
  })
})
