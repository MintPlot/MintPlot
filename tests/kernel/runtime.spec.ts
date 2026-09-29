import { describe, expect, it } from 'vitest'
import {
  createHookRegistry,
  createSeamRegistry,
  createTransientBus,
  PluginActivationError,
  PluginLoadError,
} from '@/kernel/runtime'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { KernelServices } from '@/kernel/runtime/context'
import { createKvStore, createMemoryEngine, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { uiService } from '@/kernel/ui/toasts'
import { cardPanelsSink, getRegisteredCardPanelSections, getRegisteredInputActions, inputActionsSink } from '@/kernel/app/registration-sinks'
import { pluginViewsSink, getRegisteredPluginViews } from '@/kernel/app/plugin-views'
import { getRegisteredSettingsSections, settingsSink } from '@/kernel/app/settings-registry'
import { definePlugin } from '@contracts'
import type { PluginDefinition, SessionEvent } from '@contracts'
import { createMemorySettingsState } from '../helpers/memory-settings'

// The services bundle below mirrors the bootstrap wiring so the tests exercise
// the real integration (real sinks, real bus, real ledger) — not test doubles.
function makeServices() {
  const bus = createTransientBus()
  const seamChanges: { seamId: string; providerPluginId: string | null }[] = []
  const seams = createSeamRegistry((seamId, providerPluginId) => {
    seamChanges.push({ seamId, providerPluginId })
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  const services: KernelServices = {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: { getCharacterName: () => '', getCharacterVoice: () => '', getMessageAt: () => null },
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: {
      kind: 'web',
      async getAppInfo() {
        return { platform: 'web', versionName: '1.0.0-alpha', buildType: 'dev' }
      },
    },
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: inputActionsSink,
    cardPanels: cardPanelsSink,
  }
  return { services, bus, seamChanges }
}

const FakeIcon = () => null
const FakeComponent = () => null

/** Minimal valid definition; activate steps are overridden per test. */
function makeDefinition(id: string, override: Partial<PluginDefinition> = {}): PluginDefinition {
  return definePlugin({
    manifest: {
      id,
      version: '1.0.0',
      entry: './index.ts',
      activation: 'lazy',
      display: { name: `名·${id}`, description: `${id} 简介` },
      permissions: ['view.register', 'settings.section', 'session.event.read'],
      extensionPoints: { settings: [{ id: 'main', title: id }] },
    },
    activate: () => {},
    ...override,
  })
}

/** Capture the activation failure without tripping unhandled-rejection paths. */
async function captureActivationError(run: () => Promise<void> | void): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

describe('plugin runtime · lifecycle (R-04)', () => {
  it('load validates the manifest and rejects duplicates', () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)

    expect(() => runtime.load(makeDefinition('bad-id', {
      manifest: {
        id: 'Bad_Id',
        version: 'not-semver',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·bad', description: '坏样子' },
        permissions: [],
      },
      activate: () => {},
    }))).toThrow(PluginLoadError)

    runtime.load(makeDefinition('dup-check'))
    expect(() => runtime.load(makeDefinition('dup-check'))).toThrow(/already loaded/)
    expect(runtime.stateOf('dup-check')).toBe('registered')
  })

  it('activate issues a context and broadcasts the state change', async () => {
    const { services, bus } = makeServices()
    const runtime = createPluginRuntime(services)
    const states: string[] = []
    bus.on('plugin.state.changed', (event) => states.push(`${event.pluginId}:${event.state}`))

    let seenPluginId = ''
    runtime.load(makeDefinition('lc-a', {
      activate: (ctx) => {
        seenPluginId = ctx.pluginId
      },
    }))
    await runtime.activate('lc-a')

    expect(seenPluginId).toBe('lc-a')
    expect(runtime.isActive('lc-a')).toBe(true)
    expect(states).toEqual(['lc-a:registered', 'lc-a:active'])
  })

  it('activation failure rolls back every registration already performed', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('rollback', {
      activate: (ctx) => {
        ctx.registerSettingsSection({ id: 'main', title: '回滚前注册', component: FakeComponent })
        throw new Error('boom after registering')
      },
    }))

    await expect(runtime.activate('rollback')).rejects.toThrow(PluginActivationError)
    expect(runtime.isActive('rollback')).toBe(false)
    expect(runtime.stateOf('rollback')).toBe('registered')
    expect(getRegisteredSettingsSections().some((section) => section.id === 'rollback:main')).toBe(false)
    expect(runtime.journalOf('rollback').some((entry) => entry.includes('activation failed'))).toBe(true)
  })

  it('deactivate drains the bag LIFO and runs the own hook afterwards', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    const order: string[] = []
    runtime.load(makeDefinition('lifo', {
      activate: (ctx) => {
        ctx.onDeactivate(() => {
          order.push('a')
        })
        ctx.onDeactivate(() => {
          order.push('b')
        })
        ctx.registerView({ id: 'v', title: 'v', icon: FakeIcon, component: FakeComponent })
        ctx.onDeactivate(() => {
          order.push('c')
        })
      },
      deactivate: () => {
        order.push('deactivate')
      },
    }))
    await runtime.activate('lifo')
    expect(getRegisteredPluginViews().some((view) => view.id === 'lifo:v')).toBe(true)

    await runtime.deactivate('lifo')
    expect(order).toEqual(['c', 'b', 'a', 'deactivate'])
    expect(getRegisteredPluginViews().some((view) => view.id === 'lifo:v')).toBe(false)
    expect(runtime.stateOf('lifo')).toBe('registered')
  })

  it('deactivate completes full revocation even when disposers throw', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    const revoked: string[] = []
    runtime.load(makeDefinition('full-revoke', {
      activate: (ctx) => {
        ctx.onDeactivate(() => {
          revoked.push('first')
        })
        ctx.onDeactivate(() => {
          throw new Error('disposer explodes')
        })
        ctx.onDeactivate(() => {
          revoked.push('last')
        })
      },
    }))
    await runtime.activate('full-revoke')

    await expect(runtime.deactivate('full-revoke')).rejects.toThrow(AggregateError)
    expect(revoked).toEqual(['last', 'first'])
    expect(runtime.stateOf('full-revoke')).toBe('registered')
  })

  it('unload ≡ deactivate (no runtime loader before R6)', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('unloadish'))
    await runtime.activate('unloadish')
    await runtime.unload('unloadish')
    expect(runtime.stateOf('unloadish')).toBe('registered')
  })

  it('activation/deactivation state guards', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('guards'))

    await expect(runtime.activate('missing')).rejects.toThrow(/not loaded/)
    await expect(runtime.deactivate('guards')).rejects.toThrow(/not active/)
    await runtime.activate('guards')
    await expect(runtime.activate('guards')).rejects.toThrow(/already active/)
  })
})

describe('plugin runtime · permission gating (R-11)', () => {
  it('denies undeclared registration surfaces with a diagnosed error', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('no-view-perm', {
      activate: (ctx) => {
        ctx.registerInputAction({ id: 'act', title: 'act', handler: () => {} })
      },
    }))

    await expect(runtime.activate('no-view-perm')).rejects.toThrow(PluginActivationError)
    expect(runtime.journalOf('no-view-perm').some((entry) => entry.includes('input.action'))).toBe(true)
    expect(getRegisteredInputActions()).toHaveLength(0)
  })

  it('implicit surfaces need no declaration: storage, bus, ui, platform', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('implicit', {
      activate: async (ctx) => {
        await ctx.storage.set('note', 'v1')
        expect(await ctx.storage.get<string>('note')).toBe('v1')
        expect(ctx.platform.kind).toBe('web')
        ctx.on('app.resume', () => {})
        ctx.ui.toast('hello')
      },
    }))
    await expect(runtime.activate('implicit')).resolves.toBeUndefined()
    // stored under the plugin namespace behind the mp_ engine prefix
    expect(await services.storage.get('plug:implicit:note')).toBe('v1')
  })

  it('denies undeclared seam providers and secret loans', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('no-seam', {
      activate: (ctx) => {
        ctx.registerSeamProvider('tts.engine', {})
      },
    }))
    await expect(runtime.activate('no-seam')).rejects.toThrow(PluginActivationError)

    runtime.load(makeDefinition('no-secret', {
      activate: async (ctx) => {
        await ctx.secrets.use('ttsCloudApiKey', (secret) => secret)
      },
    }))
    const secretError = await captureActivationError(() => runtime.activate('no-secret'))
    expect(secretError).toBeInstanceOf(PluginActivationError)
    expect((secretError as PluginActivationError).cause).toMatchObject({
      message: expect.stringContaining('secrets.read.ttsCloudApiKey'),
    })
    expect(runtime.journalOf('no-seam').some((entry) => entry.includes('seam.provide.tts.engine'))).toBe(true)
  })
})

describe('plugin runtime · registration surfaces', () => {
  it('storage namespaces are prefixed per plugin and isolated between plugins', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('iso-a', {
      activate: async (ctx) => {
        await ctx.storage.set('shared-name', 'from-a')
        await ctx.storage.set('nested', { deep: true })
      },
    }))
    runtime.load(makeDefinition('iso-b', {
      activate: async (ctx) => {
        await ctx.storage.set('shared-name', 'from-b')
      },
    }))
    await runtime.activate('iso-a')
    await runtime.activate('iso-b')

    expect(await services.storage.get('plug:iso-a:shared-name')).toBe('from-a')
    expect(await services.storage.get('plug:iso-b:shared-name')).toBe('from-b')
    const keys = (await services.storage.keys()).sort()
    expect(keys).toEqual([
      'plug:iso-a:nested',
      'plug:iso-a:shared-name',
      'plug:iso-b:shared-name',
    ])
  })

  it('card panel sections (reserved surface) register and revoke', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('panel', {
      manifest: {
        id: 'panel',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·panel', description: 'panel 简介' },
        permissions: ['card.panel.section'],
      },
      activate: (ctx) => {
        ctx.registerCardPanelSection({ id: 'variables', title: '变量', component: FakeComponent })
      },
    }))
    await runtime.activate('panel')
    expect(getRegisteredCardPanelSections().map((section) => section.id)).toEqual(['panel:variables'])
    await runtime.deactivate('panel')
    expect(getRegisteredCardPanelSections()).toHaveLength(0)
  })

  it('hook registration is permission-gated, ordered and revocable', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('hookless', {
      activate: (ctx) => {
        void ctx.registerHook('prompt.worldinfo', (payload, next) => next(payload))
      },
    }))
    const hookError = await captureActivationError(() => runtime.activate('hookless'))
    expect(hookError).toBeInstanceOf(PluginActivationError)
    expect((hookError as PluginActivationError).cause).toMatchObject({
      message: expect.stringContaining('hook.prompt.worldinfo'),
    })

    const definition = makeDefinition('hookful', {
      manifest: {
        id: 'hookful',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·hookful', description: 'hookful 简介' },
        permissions: ['hook.prompt.worldinfo', 'hook.prompt.memory'],
      },
      activate: (ctx) => {
        ctx.registerHook('prompt.worldinfo', (payload: string, next) => next(payload), { priority: 1 })
        ctx.registerHook('prompt.worldinfo', (payload: string, next) => next(payload), { priority: 5 })
        ctx.registerHook('prompt.worldinfo', (payload: string, next) => next(payload))
      },
    })
    runtime.load(definition)
    await runtime.activate('hookful')
    expect(services.hooks.hooksAt('prompt.worldinfo').map((hook) => hook.priority)).toEqual([5, 1, 0])
    await runtime.deactivate('hookful')
    expect(services.hooks.hooksAt('prompt.worldinfo')).toHaveLength(0)
  })
})

describe('plugin runtime · seams and bus', () => {
  it('seam provider removal falls consumers back and broadcasts the change', async () => {
    const { services, bus, seamChanges } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('seamy', {
      manifest: {
        id: 'seamy',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·seamy', description: 'seamy 简介' },
        permissions: ['seam.provide.tts.engine'],
      },
      activate: (ctx) => {
        ctx.registerSeamProvider('tts.engine', { speak: () => 'mp' })
      },
    }))

    const changes: string[] = []
    bus.on('seam.provider.changed', (event) => changes.push(`${event.seamId}:${event.providerPluginId}`))

    await runtime.activate('seamy')
    expect(services.seams.resolve('tts.engine')?.pluginId).toBe('seamy')
    await runtime.deactivate('seamy')
    expect(services.seams.resolve('tts.engine')).toBeNull()
    expect(changes).toEqual(['tts.engine:seamy', 'tts.engine:null'])
    expect(seamChanges).toEqual([
      { seamId: 'tts.engine', providerPluginId: 'seamy' },
      { seamId: 'tts.engine', providerPluginId: null },
    ])
  })

  it('transient bus subscriptions are revoked on deactivate', async () => {
    const { services, bus } = makeServices()
    const runtime = createPluginRuntime(services)
    const seen: string[] = []
    runtime.load(makeDefinition('busy', {
      activate: (ctx) => {
        ctx.on('app.resume', () => seen.push('plugin'))
      },
    }))
    await runtime.activate('busy')
    bus.emit('app.resume', {})
    await runtime.deactivate('busy')
    bus.emit('app.resume', {})
    expect(seen).toEqual(['plugin'])
  })
})

describe('plugin runtime · session events (domain A)', () => {
  it('emit is permission-gated and lands stamped in the ledger', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(makeDefinition('emitter', {
      activate: async (ctx) => {
        await ctx.emitSessionEvent({
          kind: 'message.appended',
          sessionId: 's1',
          sessionKind: 'chatbox',
          floor: 1,
          role: 'user',
          content: 'hello',
        })
      },
    }))
    const emitError = await captureActivationError(() => runtime.activate('emitter'))
    expect(emitError).toBeInstanceOf(PluginActivationError)
    expect((emitError as PluginActivationError).cause).toMatchObject({
      message: expect.stringContaining('session.event.emit.message.appended'),
    })
    expect(services.ledger.all()).toHaveLength(0)

    runtime.load(makeDefinition('emitter-ok', {
      manifest: {
        id: 'emitter-ok',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·emitter-ok', description: 'emitter-ok 简介' },
        permissions: ['session.event.emit.message.appended'],
      },
      activate: async (ctx) => {
        await ctx.emitSessionEvent({
          kind: 'message.appended',
          sessionId: 's1',
          sessionKind: 'chatbox',
          floor: 1,
          role: 'user',
          content: 'hello',
        })
      },
    }))
    await runtime.activate('emitter-ok')
    const [event] = services.ledger.all()
    expect(event?.kind).toBe('message.appended')
    expect(event?.pluginId).toBe('emitter-ok')
    expect(event?.sessionId).toBe('s1')
    expect(event?.ts).toBeGreaterThan(0)
    expect(event?.id).toBeTruthy()
  })

  it('subscription filters by type / kind / session and revokes on deactivate', async () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)
    const received: SessionEvent[] = []
    runtime.load(makeDefinition('reader', {
      activate: (ctx) => {
        ctx.onSessionEvent({ types: ['message.appended'], sessions: ['chatbox'] }, (event) => {
          received.push(event)
        })
      },
    }))
    await runtime.activate('reader')

    services.ledger.append({
      id: 'e1', ts: 1, pluginId: 'kernel', sessionId: 's1', sessionKind: 'chatbox',
      kind: 'message.appended', floor: 1, role: 'user', content: 'hit',
    })
    services.ledger.append({
      id: 'e2', ts: 2, pluginId: 'kernel', sessionId: 's2', sessionKind: 'card',
      kind: 'message.appended', floor: 1, role: 'user', content: 'miss-kind',
    })
    services.ledger.append({
      id: 'e3', ts: 3, pluginId: 'kernel', sessionId: 's3', sessionKind: 'chatbox',
      kind: 'message.deleted', messageId: 'm1',
    })
    expect(received).toHaveLength(1)

    await runtime.deactivate('reader')
    services.ledger.append({
      id: 'e4', ts: 4, pluginId: 'kernel', sessionId: 's1', sessionKind: 'chatbox',
      kind: 'message.appended', floor: 2, role: 'user', content: 'miss-revoked',
    })
    expect(received).toHaveLength(1)
  })

  it('projection carries the display card and the effective grouping (M3-h)', () => {
    const { services } = makeServices()
    const runtime = createPluginRuntime(services)

    // Bundled default → system; declared category wins over provenance;
    // installed origin → extension.
    runtime.load(makeDefinition('bundled-a'))
    runtime.load(makeDefinition('declared-ext', {
      manifest: {
        id: 'declared-ext',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·扩展化', description: '声明覆盖来源' },
        category: 'extension',
        permissions: [],
      },
    }))
    const installed = makeDefinition('installed-a', {
      manifest: {
        id: 'installed-a',
        version: '1.0.0',
        entry: './index.ts',
        activation: 'lazy',
        display: { name: '名·外装', description: '外部安装' },
        permissions: [],
      },
    })
    runtime.load(installed, 'installed')

    const byId = new Map(runtime.projection().map((entry) => [entry.id, entry]))
    expect(byId.get('bundled-a')).toMatchObject({
      display: { name: '名·bundled-a', description: 'bundled-a 简介' },
      category: 'system',
    })
    expect(byId.get('declared-ext')).toMatchObject({ category: 'extension' })
    expect(byId.get('installed-a')).toMatchObject({ category: 'extension' })
  })
})
