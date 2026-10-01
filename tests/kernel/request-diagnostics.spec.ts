import { beforeEach, describe, expect, it } from 'vitest'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import type { MpRequestDiagnostics } from '@/kernel/diagnostics/request-diagnostics'
import { createRequestDiagnostics, installRequestDiagnostics } from '@/kernel/diagnostics/request-diagnostics'

beforeEach(() => {
  errorHub.clear()
})

describe('kernel/diagnostics · MPRequestDiagnostics producer (M3-err1)', () => {
  it('begin records a journal entry; entries land on complete/fail (consumer shape)', () => {
    const diag = createRequestDiagnostics()
    const journal = diag.begin({ category: 'update', action: 'check' })
    // The exact surface update-checker/tts code against.
    expect(typeof journal.input).toBe('function')
    expect(typeof journal.behavior).toBe('function')
    expect(typeof journal.output).toBe('function')
    expect(typeof journal.complete).toBe('function')
    expect(typeof journal.fail).toBe('function')

    journal.input({ kind: 'manifest_bytes', bytes: 2048 })
    journal.behavior({ stage: 'fetch' })
    journal.complete()

    const record = errorHub.all().at(-1)!
    expect(record.category).toBe('update')
    expect(record.action).toBe('check')
    expect(record.severity).toBe('info')
    expect(record.entries).toEqual(['kind=manifest_bytes bytes=2048', 'stage=fetch'])
  })

  it('fail upgrades the record in place: message, severity and unified code', () => {
    const diag = createRequestDiagnostics()
    const journal = diag.begin({ category: 'tts', action: 'system_speak' })
    journal.input({ kind: 'speak_text', chars: 5 })
    journal.fail(new Error('engine unavailable'), { code: 'MP-TTS-001' })

    const record = errorHub.all().at(-1)!
    expect(record.severity).toBe('error')
    expect(record.message).toBe('engine unavailable')
    expect(record.code).toBe('MP-TTS-001')
    expect(record.entries).toEqual(['kind=speak_text chars=5'])

    // Error objects carrying .code work without hints.
    const second = diag.begin({ category: 'tts', action: 'cloud_speech' })
    second.fail(Object.assign(new Error('cloud 429'), { code: 'MP-NET-002' }))
    expect(errorHub.all().at(-1)!.code).toBe('MP-NET-002')
  })

  it('entries clamp to 8 per journal and 200 chars each (defense in depth)', () => {
    const diag = createRequestDiagnostics()
    const journal = diag.begin({ category: 'chat', action: 'pipeline' })
    for (let index = 0; index < 12; index += 1) {
      journal.input({ index, payload: 'x'.repeat(400) })
    }
    journal.complete()
    const record = errorHub.all().at(-1)!
    expect(record.entries).toHaveLength(8)
    expect(record.entries![0]!.length).toBeLessThanOrEqual(200)
  })

  it('getAll returns copies, getLatest/clear behave, setRecordMeta attributes the plugin', () => {
    const diag = createRequestDiagnostics()
    const journal = diag.begin({ category: 'update', action: 'download' })
    diag.setRecordMeta(journal, { pluginId: 'update-checker', context: { attempt: 2 } })
    journal.complete()

    const all = diag.getAll()
    expect(all).toHaveLength(1)
    const copy = all[0]! as { message: string }
    copy.message = 'mutated copy'
    expect(diag.getAll()[0]!.message).not.toBe('mutated copy')
    expect(diag.getAll()[0]!.pluginId).toBe('update-checker')
    expect(diag.getAll()[0]!.context).toEqual({ attempt: 2 })
    expect(diag.getLatest()!.action).toBe('download')

    diag.clear()
    expect(diag.getAll()).toHaveLength(0)
  })

  it('buildShortSummary stays within 10 paste-able lines, newest first', () => {
    const diag = createRequestDiagnostics()
    for (let index = 0; index < 14; index += 1) {
      diag.begin({ category: 'chat', action: `op-${index}` })
    }
    const lines = diag.buildShortSummary().split('\n')
    expect(lines).toHaveLength(10)
    expect(lines[0]).toContain('MP 诊断摘要')
    expect(lines[1]).toContain('op-13')
  })

  it('buildExportPayload produces the mp-error-journal/1 envelope', () => {
    const diag = createRequestDiagnostics()
    const journal = diag.begin({ category: 'update', action: 'check' })
    journal.complete()
    const payload = diag.buildExportPayload()
    expect(payload.schema).toBe('mp-error-journal/1')
    expect(payload.count).toBe(1)
    expect(payload.summary).toContain('MP 诊断摘要')
    expect(payload.records[0]).toMatchObject({ category: 'update', action: 'check' })
  })

  it('revision increments as records land; window install is idempotent', () => {
    const diag = createRequestDiagnostics()
    const before = diag.getRevision()
    diag.begin({ category: 't', action: 'a' })
    expect(diag.getRevision()).toBeGreaterThan(before)

    window.MPRequestDiagnostics = undefined
    const first = installRequestDiagnostics()
    const second = installRequestDiagnostics()
    expect(second).toBe(first)
    expect(window.MPRequestDiagnostics).toBe(first)

    const compat = (window as unknown as Record<string, unknown>).MPRequestDiagnostics as MpRequestDiagnostics
    expect(typeof compat.begin({ category: 'x', action: 'y' }).complete).toBe('function')
    window.MPRequestDiagnostics = undefined
  })
})
