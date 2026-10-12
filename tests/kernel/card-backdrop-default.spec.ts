// Global card-backdrop default (1.0.x): shell-level appearance pref in
// localStorage (mp_card_bg, theme-pref precedent). Untouched cards follow
// it; per-card envelope tuning overrides; corrupt storage falls back.
import { beforeEach, describe, expect, it } from 'vitest'
import { CARD_BG_ABSOLUTE_DEFAULT, cardBackdropDefault, sanitizeCardBackdropDefault } from '@/kernel/app/card-backdrop-default'
import type { CardBackdropDefault } from '@/kernel/app/card-backdrop-default'

describe('card-backdrop-default · 全局默认', () => {
  beforeEach(() => {
    localStorage.removeItem('mp_card_bg')
    // Normalize the module singleton between tests (it outlives one test's
    // storage mutations).
    cardBackdropDefault.value = { ...CARD_BG_ABSOLUTE_DEFAULT }
  })

  it('空存储 = 出厂默认(40px/45%)', () => {
    expect(cardBackdropDefault.value).toEqual({ blur: 40, dim: 45 })
  })

  it('修改即写入 localStorage(watcher 异步落盘)', async () => {
    cardBackdropDefault.value = { blur: 10, dim: 20 } as CardBackdropDefault
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('mp_card_bg')!)).toEqual({ blur: 10, dim: 20 })
  })

  it('越界值被钳制(模糊 ≤40,压暗 ≤80)', async () => {
    cardBackdropDefault.value = { blur: 999, dim: -5 } as CardBackdropDefault
    await Promise.resolve()
    expect(cardBackdropDefault.value).toEqual({ blur: 40, dim: 0 })
    expect(JSON.parse(localStorage.getItem('mp_card_bg')!)).toEqual({ blur: 40, dim: 0 })
  })

  it('坏 JSON/缺失字段逐字段回落出厂值', () => {
    expect(sanitizeCardBackdropDefault(null)).toEqual({ blur: 40, dim: 45 })
    expect(sanitizeCardBackdropDefault({ blur: 25 })).toEqual({ blur: 25, dim: 45 })
    expect(sanitizeCardBackdropDefault('garbage' as unknown)).toEqual({ blur: 40, dim: 45 })
  })
})
