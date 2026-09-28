import { describe, expect, it } from 'vitest'
import { createDisposerBag } from '../../contracts/disposers'

describe('createDisposerBag (R-04 semantics)', () => {
  it('runs disposers last-in-first-out', async () => {
    const bag = createDisposerBag()
    const order: string[] = []
    bag.add(() => {
      order.push('first')
    })
    bag.add(() => {
      order.push('second')
    })
    bag.add(() => {
      order.push('third')
    })
    expect(bag.size).toBe(3)

    await bag.run()
    expect(order).toEqual(['third', 'second', 'first'])
    expect(bag.size).toBe(0)
  })

  it('awaits async disposers before starting the next one', async () => {
    const bag = createDisposerBag()
    const order: string[] = []
    bag.add(async () => {
      await Promise.resolve()
      order.push('slow-first')
    })
    bag.add(async () => {
      order.push('fast-second')
    })

    await bag.run()
    expect(order).toEqual(['fast-second', 'slow-first'])
  })

  it('runs every disposer even when some throw, then reports together', async () => {
    const bag = createDisposerBag()
    const ran: string[] = []
    bag.add(() => {
      ran.push('a')
    })
    bag.add(() => {
      throw new Error('boom-1')
    })
    bag.add(async () => {
      throw new Error('boom-2')
    })
    bag.add(() => {
      ran.push('d')
    })

    await expect(bag.run()).rejects.toThrow(AggregateError)
    // Full revocation despite individual failures.
    expect(ran).toEqual(['d', 'a'])
    expect(bag.size).toBe(0)
  })

  it('rethrows an empty-error aggregate that names the failure count', async () => {
    const bag = createDisposerBag()
    bag.add(() => {
      throw new Error('only-failure')
    })
    await expect(bag.run()).rejects.toThrow(/1 disposer/)
  })
})
