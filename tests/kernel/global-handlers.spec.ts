import { beforeEach, describe, expect, it } from 'vitest'
import type { App } from 'vue'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { installGlobalErrorHandlers, replayEarlyErrors } from '@/kernel/diagnostics/global-handlers'

beforeEach(() => {
  errorHub.clear()
})

describe('kernel/diagnostics · global-handlers (M3-err1)', () => {
  it('the Vue net records component errors with component name and info', () => {
    const app = { config: {} } as unknown as App
    installGlobalErrorHandlers(app)
    expect(typeof app.config.errorHandler).toBe('function')

    app.config.errorHandler!(new Error('render boom'), { $options: { name: 'SomeView' } } as never, 'render')
    const record = errorHub.all().at(-1)
    expect(record?.code).toBe('MP-RUN-001')
    expect(record?.severity).toBe('error')
    expect(record?.message).toBe('render boom')
    expect(record?.context).toMatchObject({ component: 'SomeView', info: 'render' })
  })

  it('the window net separates script errors from resource load failures', () => {
    installGlobalErrorHandlers({ config: {} } as unknown as App)

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('script boom'), message: 'script boom' }))
    let record = errorHub.all().at(-1)
    expect(record?.code).toBe('MP-RUN-002')

    const img = document.createElement('img')
    document.body.appendChild(img)
    img.dispatchEvent(new Event('error'))
    record = errorHub.all().at(-1)
    expect(record?.code).toBe('MP-RUN-003')
    expect(record?.severity).toBe('warn')
    expect(record?.message).toContain('资源加载失败')
    img.remove()
  })

  it('the promise net catches unhandled rejections', () => {
    installGlobalErrorHandlers({ config: {} } as unknown as App)
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('rejected boom') })
    window.dispatchEvent(event)
    const record = errorHub.all().at(-1)
    expect(record?.code).toBe('MP-RUN-004')
    expect(record?.message).toBe('rejected boom')
  })

  it('replays the pre-boot buffer into the journal and clears it', () => {
    window.__mpEarlyErrors = ['early one', 'early two']
    replayEarlyErrors()
    const records = errorHub.all().filter((record) => record.code === 'MP-RUN-005')
    expect(records.map((record) => record.message)).toEqual(['early one', 'early two'])
    expect(window.__mpEarlyErrors).toBeUndefined()

    replayEarlyErrors() // idempotent when nothing is buffered
    expect(errorHub.all().filter((record) => record.code === 'MP-RUN-005')).toHaveLength(2)
  })
})
