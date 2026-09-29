/**
 * Kernel plugin runtime — public surface for the composition root and shell
 * (kernel-internal consumers; plugins never import from here, they receive
 * their PluginContext at activation).
 */

export { createPluginRuntime, PluginLoadError, PluginActivationError } from './runtime'
export type { PluginRuntime, PluginRecord, PluginStateProjection } from './runtime'
export { createPluginContext, stampSessionEvent, PermissionDeniedError, createActivationBag } from './context'
export type {
  KernelServices,
  ViewSink,
  SettingsSink,
  InputActionSink,
  CardPanelSink,
  UiService,
} from './context'
export { createTransientBus } from './event-bus'
export type { TransientBus } from './event-bus'
export { createSeamRegistry } from './seam-registry'
export type { SeamRegistry, SeamProvider } from './seam-registry'
export { createHookRegistry } from './hooks'
export type { HookRegistry, HookRecord } from './hooks'
