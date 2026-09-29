/**
 * Shared test helper: a real settings state over an in-memory repository
 * (type-faithful for KernelServices construction; tests that need exact
 * persistence timing use their own timers).
 */

import { createSettingsState } from '@/kernel/settings/settings-state'
import type { SettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

export function createMemorySettingsState(): SettingsState {
  return createSettingsState(createStorageRepository(createMemoryEngine()))
}
