import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  crc32,
  listZipArchiveEntries,
  looksLikeZipArchive,
  readZipArchiveEntry,
  writeZipArchive,
  ZipArchiveError,
} from '@/kernel/dataio/zip-archive'

/** Hand-built one-entry METHOD_DEFLATED archive — the writer is store-only,
 *  so the deflated read path needs an externally-shaped fixture. */
const buildDeflatedZip = (name: string, data: Uint8Array): Uint8Array => {
  const compressed = new Uint8Array(deflateRawSync(data))
  const nameBytes = new TextEncoder().encode(name)
  const crc = crc32(data)
  const local = new Uint8Array(30 + nameBytes.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 20, true)
  localView.setUint16(6, 0x0800, true)
  localView.setUint16(8, 8, true)
  localView.setUint32(14, crc, true)
  localView.setUint32(18, compressed.length, true)
  localView.setUint32(22, data.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  const central = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(4, 20, true)
  centralView.setUint16(6, 20, true)
  centralView.setUint16(8, 0x0800, true)
  centralView.setUint16(10, 8, true)
  centralView.setUint32(16, crc, true)
  centralView.setUint32(20, compressed.length, true)
  centralView.setUint32(24, data.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralView.setUint32(42, 0, true)
  central.set(nameBytes, 46)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, 1, true)
  eocdView.setUint16(10, 1, true)
  eocdView.setUint32(12, central.length, true)
  eocdView.setUint32(16, local.length + compressed.length, true)
  const archive = new Uint8Array(local.length + compressed.length + central.length + 22)
  archive.set(local, 0)
  archive.set(compressed, local.length)
  archive.set(central, local.length + compressed.length)
  archive.set(eocd, local.length + compressed.length + central.length)
  return archive
}

const zlibInflateRaw = async (data: Uint8Array): Promise<Uint8Array> => new Uint8Array(inflateRawSync(data))

const hasStreamStack =
  typeof DecompressionStream === 'function' && typeof ReadableStream === 'function' && typeof Response === 'function'

describe('kernel/dataio · zip archive (M4-g4)', () => {
  it('crc32 matches the standard check vectors', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a store-only archive whose entries list and round-trip back', async () => {
    const first = new TextEncoder().encode('{"format":"mintplot-backup"}')
    const second = new TextEncoder().encode('第二份数据')
    const archive = writeZipArchive([
      { name: 'mintplot-backup.json', data: first },
      { name: '世界书.json', data: second },
    ])
    expect(looksLikeZipArchive(archive)).toBe(true)
    const entries = listZipArchiveEntries(archive)
    expect(entries.map((entry) => entry.name)).toEqual(['mintplot-backup.json', '世界书.json'])
    expect(entries.every((entry) => entry.method === 0)).toBe(true)
    // Content compare (Array.from): vitest's jsdom environment resolves the
    // test file and the src module to different Uint8Array prototypes, so a
    // direct toEqual on typed arrays fails on identity despite equal bytes.
    expect(Array.from(await readZipArchiveEntry(archive, 'mintplot-backup.json'))).toEqual(Array.from(first))
    expect(Array.from(await readZipArchiveEntry(archive, '世界书.json'))).toEqual(Array.from(second))
  })

  it('looksLikeZipArchive only accepts zip magic', () => {
    expect(looksLikeZipArchive(writeZipArchive([{ name: 'a', data: new Uint8Array(1) }]))).toBe(true)
    expect(looksLikeZipArchive(new TextEncoder().encode('{"format":"x"}'))).toBe(false)
    expect(looksLikeZipArchive(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })

  it('rejects a missing entry, a truncated archive and corrupted payload', async () => {
    const data = new TextEncoder().encode('{"a":1}')
    const archive = writeZipArchive([{ name: 'a.json', data }])
    await expect(readZipArchiveEntry(archive, 'missing.json')).rejects.toThrow('压缩包中没有条目 missing.json')
    await expect(readZipArchiveEntry(archive.slice(0, archive.length - 10), 'a.json')).rejects.toThrow(ZipArchiveError)
    const entry = listZipArchiveEntries(archive)[0]!
    const corrupted = archive.slice()
    const view = new DataView(corrupted.buffer)
    const localNameLength = view.getUint16(entry.localHeaderOffset + 26, true)
    corrupted[entry.localHeaderOffset + 30 + localNameLength] ^= 0xff // first payload byte
    await expect(readZipArchiveEntry(corrupted, 'a.json')).rejects.toThrow('校验失败')
  })

  it('reads a deflated entry through the injected inflater', async () => {
    const data = new TextEncoder().encode('{"kv":{"chat:card:x":"{\\"a\\":1}"}}'.repeat(20))
    const archive = buildDeflatedZip('backup.json', data)
    expect(listZipArchiveEntries(archive)[0]!.method).toBe(8)
    expect(listZipArchiveEntries(archive)[0]!.compressedSize).toBeLessThan(data.length)
    expect(Array.from(await readZipArchiveEntry(archive, 'backup.json', { inflateRaw: zlibInflateRaw }))).toEqual(Array.from(data))
  })

  it.skipIf(!hasStreamStack)('reads a deflated entry through the platform DecompressionStream', async () => {
    const data = new TextEncoder().encode('平台解压链路'.repeat(64))
    const archive = buildDeflatedZip('backup.json', data)
    expect(Array.from(await readZipArchiveEntry(archive, 'backup.json'))).toEqual(Array.from(data))
  })
})
