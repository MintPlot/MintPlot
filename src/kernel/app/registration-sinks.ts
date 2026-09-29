/**
 * Input-action + card-panel registries (kernel/app) — the two remaining
 * registration surfaces of the v1 contract. The input dock `[+]` panel is
 * reserved in the v1 UI (spec v1.2 §02) and card panel sections are reserved
 * for the variables plugin; both registries exist so plugins can register and
 * the runtime can gate them from day one.
 */

import { ref } from 'vue'
import type { CardPanelSectionSpec, InputActionSpec } from '@contracts'
import type { CardPanelSink, InputActionSink } from '@/kernel/runtime/context'

export interface InputActionDescriptor {
  /** Namespaced: `<pluginId>:<spec.id>`. */
  readonly id: string
  readonly pluginId: string
  readonly spec: InputActionSpec
}

const inputActions = ref<InputActionDescriptor[]>([])

export const inputActionsSink: InputActionSink = {
  registerAction(pluginId, spec) {
    const id = `${pluginId}:${spec.id}`
    if (inputActions.value.some((action) => action.id === id)) {
      throw new Error(`[input-actions] duplicate action id: ${id}`)
    }
    inputActions.value = [...inputActions.value, { id, pluginId, spec }]
    return () => {
      inputActions.value = inputActions.value.filter((action) => action.id !== id)
    }
  },
}

export function getRegisteredInputActions(): readonly InputActionDescriptor[] {
  return inputActions.value
}

export interface CardPanelSectionDescriptor {
  /** Namespaced: `<pluginId>:<spec.id>`. */
  readonly id: string
  readonly pluginId: string
  readonly spec: CardPanelSectionSpec
}

const cardPanelSections = ref<CardPanelSectionDescriptor[]>([])

export const cardPanelsSink: CardPanelSink = {
  registerSection(pluginId, spec) {
    const id = `${pluginId}:${spec.id}`
    if (cardPanelSections.value.some((section) => section.id === id)) {
      throw new Error(`[card-panels] duplicate section id: ${id}`)
    }
    cardPanelSections.value = [...cardPanelSections.value, { id, pluginId, spec }]
    return () => {
      cardPanelSections.value = cardPanelSections.value.filter((section) => section.id !== id)
    }
  },
}

/** Reserved surface (variables plugin, M4) — registry kept observable for tests. */
export function getRegisteredCardPanelSections(): readonly CardPanelSectionDescriptor[] {
  return cardPanelSections.value
}
