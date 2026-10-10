import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveFileBridge } from '@/kernel/dataio/file-bridge'

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('kernel/dataio · file bridge native path (M4-g1)', () => {
  it('export streams base64 chunks through exportStart/Write/End', async () => {
    const payload = new Uint8Array(300 * 1024).map((_, index) => index % 251)
    const writes: string[] = []
    const bridge = {
      exportStart: vi.fn().mockResolvedValue({ ready: true, sessionId: 's1' }),
      exportWrite: vi.fn().mockImplementation(async ({ chunk }: { chunk: string }) => {
        writes.push(chunk)
      }),
      exportEnd: vi.fn().mockResolvedValue({ saved: true }),
      importOpen: vi.fn(),
      importRead: vi.fn(),
    }
    ;(window as { Capacitor?: unknown }).Capacitor = { Plugins: { MpFiles: bridge } }
    const saved = await resolveFileBridge().exportFile('backup.json', 'application/json', payload)
    expect(saved).toBe(true)
    expect(bridge.exportStart).toHaveBeenCalledWith({ fileName: 'backup.json', mimeType: 'application/json' })
    expect(writes.length).toBe(2) // 300KB over 256KB chunks
    // Each chunk carries its own base64 padding — decode per chunk.
    const binary = writes.map((chunk) => atob(chunk)).join('')
    expect(binary.length).toBe(payload.length)
    for (let index = 0; index < payload.length; index += 1) expect(binary.charCodeAt(index)).toBe(payload[index]!)
  })

  it('a cancelled picker resolves false; import of a cancelled picker resolves null', async () => {
    const bridge = {
      exportStart: vi.fn().mockResolvedValue({ ready: false }),
      exportWrite: vi.fn(),
      exportEnd: vi.fn(),
      importOpen: vi.fn().mockResolvedValue({ ready: false }),
      importRead: vi.fn(),
    }
    ;(window as { Capacitor?: unknown }).Capacitor = { Plugins: { MpFiles: bridge } }
    const fb = resolveFileBridge()
    await expect(fb.exportFile('x.json', 'application/json', new Uint8Array([1]))).resolves.toBe(false)
    await expect(fb.importFile()).resolves.toBeNull()
    expect(bridge.exportWrite).not.toHaveBeenCalled()
  })

  it('import loops chunks until eof and merges the bytes', async () => {
    const payload = new TextEncoder().encode('{"kv":{}}')
    const first = btoa(String.fromCharCode(...payload.subarray(0, 5)))
    const second = btoa(String.fromCharCode(...payload.subarray(5)))
    const bridge = {
      exportStart: vi.fn(),
      exportWrite: vi.fn(),
      exportEnd: vi.fn(),
      importOpen: vi.fn().mockResolvedValue({ ready: true, sessionId: 's2', size: payload.length }),
      importRead: vi
        .fn()
        .mockResolvedValueOnce({ eof: false, chunk: first })
        .mockResolvedValueOnce({ eof: false, chunk: second })
        .mockResolvedValueOnce({ eof: true, chunk: '' }),
    }
    ;(window as { Capacitor?: unknown }).Capacitor = { Plugins: { MpFiles: bridge } }
    const bytes = await resolveFileBridge().importFile()
    expect(new TextDecoder().decode(bytes!)).toBe('{"kv":{}}')
  })
})

describe('kernel/dataio · file bridge browser fallback (M4-g1)', () => {
  it('export downloads a blob via an anchor; import rides a file input', async () => {
    const clickSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement
      }
      if (tag === 'input') {
        return {
          type: '',
          accept: '',
          onchange: null,
          files: [new File([new TextEncoder().encode('文件内容')], 'backup.json')],
          click() {
            ;(this as unknown as { onchange: () => void }).onchange()
          },
        } as unknown as HTMLInputElement
      }
      throw new Error(`unexpected createElement(${tag}) in test`)
    })
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    ;(window as { URL?: unknown }).URL = Object.assign(window.URL, { createObjectURL, revokeObjectURL })
    const fb = resolveFileBridge()
    await expect(fb.exportFile('backup.json', 'application/json', new Uint8Array([1, 2]))).resolves.toBe(true)
    expect(clickSpy).toHaveBeenCalled()
    const content = await fb.importFile()
    expect(new TextDecoder().decode(content!)).toBe('文件内容')
  })
})
