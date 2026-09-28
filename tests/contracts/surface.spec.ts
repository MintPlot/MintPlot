import { describe, expect, expectTypeOf, it } from 'vitest'
import * as contracts from '../../contracts/index'
import type {
  CardPanelSectionSpec,
  ConfirmOptions,
  FlattenPromptArtifact,
  HookHandler,
  InputActionSpec,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginStorage,
  PromptArtifact,
  PromptMessage,
  PromptSection,
  SessionEventInput,
  SettingsSectionSpec,
  ViewSpec,
} from '../../contracts/index'
import { createDisposerBag } from '../../contracts/disposers'

/**
 * Public surface lock: the barrel (`@contracts`) is the only kernel path
 * plugins will ever import (R-05 isomorphism discipline). This suite fails
 * when a runtime export is renamed or dropped, and pins the context surface
 * at the type level.
 */

describe('contracts public surface', () => {
  it('exports the manifest helpers', () => {
    expect(typeof contracts.validateManifest).toBe('function')
    expect(typeof contracts.definePlugin).toBe('function')
    expect([...contracts.RESERVED_PLUGIN_IDS]).toEqual(['kernel', 'mintplot'])
  })

  it('exports the permission validators', () => {
    expect(typeof contracts.checkPermission).toBe('function')
    expect(typeof contracts.checkPermissions).toBe('function')
  })

  it('exports the extension point catalogs', () => {
    expect(contracts.PIPELINE_POINTS.length).toBeGreaterThan(0)
    expect(contracts.SESSION_EVENT_TYPES.length).toBeGreaterThan(0)
    expect(contracts.TRANSIENT_EVENT_TYPES.length).toBeGreaterThan(0)
    expect(contracts.PUBLIC_SEAM_IDS.length).toBeGreaterThan(0)
    expect(contracts.SESSION_KINDS.length).toBe(2)
  })

  it('exports the variable reservations', () => {
    expect(contracts.VARIABLE_SET_EVENT_TYPE).toBe('variable.set')
    expect(contracts.VARIABLE_EXPAND_POINT).toBe('variable-expand')
    expect(contracts.CARD_PANEL_SECTION_PERMISSION).toBe('card.panel.section')
  })

  it('exports the disposer bag factory', () => {
    expect(createDisposerBag().size).toBe(0)
  })
})

describe('PluginContext type surface (R-05)', () => {
  it('carries every v1 registration surface and implicit member', () => {
    expectTypeOf<PluginContext>().toExtend<{
      readonly pluginId: string
      registerView(spec: ViewSpec): () => void
      registerSettingsSection(spec: SettingsSectionSpec): () => void
      registerInputAction(spec: InputActionSpec): () => void
      registerCardPanelSection(spec: CardPanelSectionSpec): () => void
      registerSeamProvider(seamId: string, implementation: unknown): () => void
      readonly storage: PluginStorage
      onDeactivate(fn: () => void): void
    }>()
  })

  it('exposes the ui bridge with toast and confirm', () => {
    expectTypeOf<PluginContext['ui']['confirm']>().toExtend<
      (options: ConfirmOptions) => Promise<boolean>
    >()
  })

  it('lets a plugin loan a secret only through a callback scope', () => {
    expectTypeOf<PluginContext['secrets']['use']>().toExtend<
      <T>(key: string, fn: (secret: string) => Promise<T> | T) => Promise<T>
    >()
  })

  it('types the waterfall handler as (payload, next) → result', () => {
    expectTypeOf<HookHandler<string, string>>().toEqualTypeOf<
      (payload: string, next: (value: string) => string) => string
    >()
  })
})

describe('lifecycle type surface (R-04)', () => {
  it('requires activate(ctx) and allows optional deactivate', () => {
    expectTypeOf<PluginDefinition>().toExtend<{
      activate(ctx: PluginContext): Promise<void> | void
      deactivate?(): Promise<void> | void
    }>()
  })
})

describe('session event input (ledger attribution)', () => {
  it('hides id/ts/pluginId from emitters — the runtime stamps them', () => {
    expectTypeOf<SessionEventInput>().not.toExtend<{ id: string }>()
    expectTypeOf<SessionEventInput>().not.toExtend<{ ts: number }>()
    expectTypeOf<SessionEventInput>().not.toExtend<{ pluginId: string }>()
  })
})

describe('prompt artifact (R-10)', () => {
  it('pins the schema version literal', () => {
    expectTypeOf<PromptArtifact['schema']>().toEqualTypeOf<1>()
  })

  it('keeps history sections immutable and every section attributed', () => {
    expectTypeOf<PromptSection>().toExtend<{
      id: string
      source: { plugin: string; ref: string; label: string }
      mutable: boolean
    }>()
  })

  it('types flatten as a pure artifact → messages projection', () => {
    expectTypeOf<FlattenPromptArtifact>().toEqualTypeOf<
      (artifact: PromptArtifact) => PromptMessage[]
    >()
  })
})

describe('manifest type surface (R-03 + spec addition)', () => {
  it('makes the session-kind declaration optional and kind-scoped', () => {
    expectTypeOf<PluginManifest['sessions']>().toEqualTypeOf<readonly ('chatbox' | 'card')[] | undefined>()
  })
})
