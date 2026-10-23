import type { VariableState } from '@contracts'
import type { CharacterCard } from '@/kernel/characters/character-card'
import { readCardVariableDefaults } from '@/kernel/variables/variable-engine'

/** Shared by entry preparation and reset; neither path seeds a second ledger. */
export function buildCardVariableDefaults(card: CharacterCard, templatesEnabled = true): Array<{ name: string; value: VariableState['value'] }> {
  const templates = templatesEnabled
    ? [...(card.uiTemplates ?? [])].filter((entry) => entry.enabled).sort((a, b) => b.order - a.order)
    : []
  return [
    ...readCardVariableDefaults(card.extensions),
    ...templates.map((entry) => ({
      name: entry.id,
      value: JSON.parse(JSON.stringify(entry.initialVariableState)) as VariableState['value'],
    })),
  ]
}
