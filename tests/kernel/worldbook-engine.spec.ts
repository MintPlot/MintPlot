import { describe, expect, it } from 'vitest'
import {
  activateWorldbookEntries,
  applyWorldbookBudget,
  buildWorldbookInjections,
  estimateTokens,
  projectWorldbook,
  projectWorldbookEntry,
  renderWorldbookInjections,
} from '@/kernel/worldinfo/worldbook-engine'

const SETTINGS = { scanDepth: 2, maxDepth: 0, tokenBudget: 0 }

describe('worldbook projection (M3-u, verbatim storage → runtime view)', () => {
  it('merges dual spellings with extensions overriding root (RP normalize semantics)', () => {
    const entry = projectWorldbookEntry({
      key: '灵石, 元石',
      keys: ['灵石'],
      constant: 'true',
      insertion_order: 7,
      disable: false,
      extensions: { position: 4, depth: 6 },
    }, 0)
    expect(entry).toMatchObject({
      keys: ['灵石'],
      constant: true,
      order: 7,
      position: 'at_depth',
      depth: 6,
      enabled: true,
      probability: 100,
    })
  })

  it('maps ccv3 numeric positions and folds AN top/bottom to global_note', () => {
    expect(projectWorldbookEntry({ position: 0 }, 0)!.position).toBe('before_char')
    expect(projectWorldbookEntry({ position: 1 }, 0)!.position).toBe('after_char')
    expect(projectWorldbookEntry({ position: 2 }, 0)!.position).toBe('global_note')
    expect(projectWorldbookEntry({ position: 3 }, 0)!.position).toBe('global_note')
    expect(projectWorldbookEntry({ position: 4 }, 0)!.position).toBe('at_depth')
    // The ecosystem-degenerate value keeps the book playable (degrades to at_depth).
    expect(projectWorldbookEntry({ position: 'global_note' }, 0)!.position).toBe('global_note')
    expect(projectWorldbookEntry({ position: 'nonsense' }, 0)!.position).toBe('at_depth')
  })

  it('projects the real-card shapes: global_note string position, disable flag, comma keys', () => {
    const book = projectWorldbook({
      entries: [
        { uid: 0, comment: '数据块输出', keys: ['数据块'], content: '协议', enabled: true, constant: true, position: 'global_note', depth: 4 },
        { uid: 1, comment: '旧条目', key: 'A，B', content: 'x', disable: true, position: 'global_note' },
      ],
    })
    expect(book).toHaveLength(2)
    expect(book[0]).toMatchObject({ comment: '数据块输出', constant: true, position: 'global_note', depth: 4, enabled: true })
    expect(book[1]).toMatchObject({ keys: ['A', 'B'], enabled: false })
  })

  it('non-object book shapes project to nothing', () => {
    expect(projectWorldbook(undefined)).toEqual([])
    expect(projectWorldbook({})).toEqual([])
    expect(projectWorldbook({ entries: 'nope' })).toEqual([])
  })
})

describe('activation (constant always; keyed substring/regex; scan controls)', () => {
  const entries = [
    projectWorldbookEntry({ comment: '蓝', content: 'c', constant: true, order: 10 }, 0)!,
    projectWorldbookEntry({ comment: '绿', content: 'g', keys: ['中洲'], order: 5 }, 1)!,
    projectWorldbookEntry({ comment: '正则', content: 'r', keys: ['/时\\d+/'], use_regex: true, order: 4 }, 2)!,
    projectWorldbookEntry({ comment: '扫描关闭', content: 'x', keys: ['中洲'], scan_depth: 0, order: 3 }, 3)!,
  ]

  it('constants activate unconditionally; green keys match case-insensitive substring', () => {
    const { activated, notTriggered } = activateWorldbookEntries({
      entries,
      scanText: '我们向中洲出发',
      turnSeed: 1,
      settings: SETTINGS,
    })
    expect(activated.map((entry) => entry.comment)).toEqual(['蓝', '绿'])
    expect(notTriggered).toBe(2)
  })

  it('regex keys match with /pattern/flags and skip invalid patterns', () => {
    const { activated } = activateWorldbookEntries({
      entries,
      scanText: '已到此时3日记',
      turnSeed: 1,
      settings: SETTINGS,
    })
    expect(activated.map((entry) => entry.comment)).toEqual(['蓝', '正则'])
  })

  it('budget order is order-descending regardless of activation kind (no constant reservation)', () => {
    const greenHigh = projectWorldbookEntry({ comment: '高绿灯', content: 'g', keys: ['中洲'], insertion_order: 99 }, 4)!
    const { activated } = activateWorldbookEntries({
      entries: [...entries, greenHigh],
      scanText: '中洲',
      turnSeed: 1,
      settings: SETTINGS,
    })
    expect(activated.map((entry) => entry.comment)).toEqual(['高绿灯', '蓝', '绿'])
  })

  it('per-entry disabled overrides remove entries from activation', () => {
    const { activated } = activateWorldbookEntries({
      entries,
      scanText: '中洲',
      turnSeed: 1,
      settings: SETTINGS,
      disabledUids: new Set([0, 1]),
    })
    expect(activated).toHaveLength(0)
  })
})

describe('budget (whole-entry greedy fill, constants included, 0 = unlimited)', () => {
  const big = (order: number, content: string): NonNullable<ReturnType<typeof projectWorldbookEntry>> =>
    projectWorldbookEntry({ comment: `条${order}`, content, constant: true, insertion_order: order }, order)!

  it('drops whole entries once the budget is exhausted — no trimming, drop counted', () => {
    const activated = [big(3, '甲'.repeat(100)), big(2, '乙'.repeat(100)), big(1, '丙'.repeat(100))]
    // 100 CJK chars ≈ 80 tokens: the first entry fits a 100-token budget, the
    // second would exceed it and BOTH remaining entries drop whole.
    const { kept, droppedByBudget } = applyWorldbookBudget(activated, 100)
    expect(kept.map((entry) => entry.comment)).toEqual(['条3'])
    expect(droppedByBudget).toBe(2)
  })

  it('budget 0 means unlimited', () => {
    const activated = [big(3, '甲'.repeat(500)), big(2, '乙'.repeat(500))]
    const { kept, droppedByBudget } = applyWorldbookBudget(activated, 0)
    expect(kept).toHaveLength(2)
    expect(droppedByBudget).toBe(0)
  })

  it('token estimate weighs CJK heavier than ascii words', () => {
    expect(estimateTokens('蛊蛊蛊蛊蛊')).toBe(4)
    expect(estimateTokens('one two three four')).toBeGreaterThan(1)
  })
})

describe('injection rendering (seven positions, wrapper, order ascending)', () => {
  it('wraps as [comment]\\ncontent, per-position groups sorted order-ascending', () => {
    const kept = [
      projectWorldbookEntry({ comment: '低', content: 'L', insertion_order: 1, position: 'global_note' }, 0)!,
      projectWorldbookEntry({ comment: '高', content: 'H', insertion_order: 9, position: 'global_note' }, 1)!,
      projectWorldbookEntry({ comment: '深度', content: 'D', insertion_order: 5, position: 4, depth: 2 }, 2)!,
    ]
    const injections = renderWorldbookInjections(kept)
    expect(injections).toHaveLength(2)
    expect(injections[0]).toMatchObject({ position: 'global_note', depth: 0 })
    // order ascending: lower order renders FIRST (higher order = later = more impact)
    expect(injections[0]!.content).toBe('[低]\nL\n\n[高]\nH')
    expect(injections[1]).toMatchObject({ position: 'at_depth', depth: 2 })
    expect(injections[1]!.content).toBe('[深度]\nD')
  })
})

describe('full pipeline artifact (buildWorldbookInjections)', () => {
  it('counts injected / budget-dropped / not-triggered honestly', () => {
    const book = {
      entries: [
        { comment: '蓝灯', content: '甲'.repeat(200), constant: true, insertion_order: 10, position: 'global_note' },
        { comment: '命中', content: '短内容', keys: ['中洲'], insertion_order: 5, position: 'global_note' },
        { comment: '未中', content: 'x', keys: ['永不出现'], insertion_order: 1, position: 'global_note' },
        { comment: '超额', content: '乙'.repeat(2000), constant: true, insertion_order: 2, position: 'global_note' },
      ],
    }
    const artifact = buildWorldbookInjections({
      book,
      scanText: '中洲见',
      turnSeed: 3,
      settings: { scanDepth: 2, maxDepth: 0, tokenBudget: 300 },
    })
    expect(artifact.injected.map((item) => item.comment)).toEqual(['蓝灯', '命中'])
    expect(artifact.droppedByBudget).toBe(1)
    expect(artifact.notTriggered).toBe(1)
    expect(artifact.injections[0]!.content).toContain('[蓝灯]')
    expect(artifact.injections[0]!.content).toContain('[命中]')
  })
})
