import { describe, expect, it } from 'vitest'
import { ERROR_CODES, errorCodeLabel, errorCodeSpec } from '@/kernel/diagnostics/error-codes'

describe('kernel/diagnostics · error-codes (M3-err1)', () => {
  it('every code matches the MP-<DOMAIN>-<NNN> format and ids stay unique', () => {
    const seen = new Set<string>()
    for (const spec of ERROR_CODES) {
      expect(spec.code).toMatch(/^MP-[A-Z]+-\d{3}$/)
      expect(spec.name).not.toBe('')
      expect(spec.description).not.toBe('')
      expect(seen.has(spec.code)).toBe(false)
      seen.add(spec.code)
    }
    expect(seen.size).toBeGreaterThanOrEqual(15)
  })

  it('core domains are all present', () => {
    const domains = new Set(ERROR_CODES.map((spec) => spec.code.split('-')[1]))
    expect(domains).toEqual(new Set(['RUN', 'NET', 'CHAT', 'STORE', 'PLUGIN', 'CARD']))
  })

  it('lookup resolves known codes and tolerates unknown ones (open registry)', () => {
    expect(errorCodeSpec('MP-NET-001')?.name).toBe('request_timeout')
    expect(errorCodeSpec('MP-XX-999')).toBeUndefined()
    expect(errorCodeSpec(undefined)).toBeUndefined()
  })

  it('label shows the description for known codes, the raw code otherwise', () => {
    expect(errorCodeLabel('MP-STORE-001')).toContain('IndexedDB')
    expect(errorCodeLabel('MP-XX-999')).toBe('MP-XX-999')
    expect(errorCodeLabel(undefined)).toBe('')
  })
})
