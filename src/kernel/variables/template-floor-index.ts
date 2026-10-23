import type { VariableSetEvent, VariableValue } from '@contracts'

interface Checkpoint {
  floor: number
  sequence: number
  value: VariableValue
}

/** Derived index over an immutable, candidate-filtered snapshot. Values stay
 * owned by the ledger: callers must not mutate the returned trees.
 *
 * Floor order and ledger order can differ after reanalysing an old floor.
 * Sort by attributed floor, then retain the greatest ledger sequence in each
 * prefix. A binary search then matches pure replay without cloning every
 * intermediate state for every visible panel. Manual/null/unknown-id events
 * keep the attribution rules of replayTemplateStateAtFloor. */
export function createTemplateFloorIndex(
  events: readonly VariableSetEvent[],
  floorIndexOf: (messageId: string) => number,
) {
  const inherited = new Map<string, number>()
  const groups = new Map<string, Checkpoint[]>()
  for (let sequence = 0; sequence < events.length; sequence++) {
    const event = events[sequence]!
    let floor = inherited.get(event.name) ?? 0
    if (event.messageId) {
      const resolved = floorIndexOf(event.messageId)
      floor = Number.isInteger(resolved) && resolved >= 0 ? resolved : Number.POSITIVE_INFINITY
    }
    if (Number.isFinite(floor)) inherited.set(event.name, floor)
    if (event.after === null) continue
    let group = groups.get(event.name)
    if (!group) groups.set(event.name, group = [])
    group.push({ floor, sequence, value: event.after })
  }
  for (const [name, group] of groups) {
    group.sort((a, b) => a.floor - b.floor || a.sequence - b.sequence)
    const checkpoints: Checkpoint[] = []
    let latest = -1
    for (const point of group) {
      if (point.sequence <= latest) continue
      latest = point.sequence
      checkpoints.push(point)
    }
    groups.set(name, checkpoints)
  }
  return {
    at(name: string, targetFloor: number): VariableValue | undefined {
      const group = groups.get(name)
      if (!group) return undefined
      let low = 0
      let high = group.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (group[mid]!.floor <= targetFloor) low = mid + 1
        else high = mid
      }
      return low > 0 ? group[low - 1]!.value : undefined
    },
  }
}
