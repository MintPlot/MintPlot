/**
 * Minimal zip container (M4-g4) — store-only writer + read side for the MP
 * self-backup container. The backup payload is one JSON document, so the
 * archive is deliberately the simplest legal zip: METHOD_STORED entries,
 * UTF-8 names, no zip64. This keeps the export a .zip file (user-facing
 * archive semantics, same convention as the RP/ST backups the import panel
 * already reads) without pulling a compression dependency into the kernel.
 *
 * The reader also accepts METHOD_DEFLATED entries (hand-re-zipped files)
 * through DecompressionStream('deflate-raw') when the platform provides it;
 * an inflater can be injected for environments without it.
 */

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipArchiveError'
  }
}

export interface ZipEntryInput {
  name: string
  data: Uint8Array
}

export interface ZipArchiveEntry {
  name: string
  /** 0 = stored, 8 = deflated. */
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50
const ZIP_EOCD_SIGNATURE = 0x06054b50
/** General-purpose bit 11: the entry name is UTF-8. */
const ZIP_UTF8_FLAG = 0x0800
/** Version needed to extract — 2.0 covers stored and deflated entries. */
const ZIP_VERSION_NEEDED = 20
const ZIP_EOCD_FIXED_LENGTH = 22
const ZIP_EOCD_COMMENT_LIMIT = 0xffff

const buildCrc32Table = (): Uint32Array => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

const CRC32_TABLE = buildCrc32Table()

export const crc32 = (bytes: Uint8Array): number => {
  let crc = -1
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

const writeDosDateTime = (view: DataView, offset: number, now: Date): void => {
  const year = Math.max(1980, now.getFullYear())
  view.setUint16(offset, (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), true)
  view.setUint16(offset + 2, ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), true)
}

export const writeZipArchive = (entries: ZipEntryInput[], now = new Date()): Uint8Array => {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, ZIP_LOCAL_HEADER_SIGNATURE, true)
    localView.setUint16(4, ZIP_VERSION_NEEDED, true)
    localView.setUint16(6, ZIP_UTF8_FLAG, true)
    localView.setUint16(8, 0, true)
    writeDosDateTime(localView, 10, now)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, ZIP_CENTRAL_HEADER_SIGNATURE, true)
    centralView.setUint16(4, ZIP_VERSION_NEEDED, true)
    centralView.setUint16(6, ZIP_VERSION_NEEDED, true)
    centralView.setUint16(8, ZIP_UTF8_FLAG, true)
    centralView.setUint16(10, 0, true)
    writeDosDateTime(centralView, 12, now)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, entry.data.length, true)
    centralView.setUint32(24, entry.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    localParts.push(local, entry.data)
    centralParts.push(central)
    offset += local.length + entry.data.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(ZIP_EOCD_FIXED_LENGTH)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, ZIP_EOCD_SIGNATURE, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)
  const archive = new Uint8Array(offset + centralSize + ZIP_EOCD_FIXED_LENGTH)
  let position = 0
  for (const part of [...localParts, ...centralParts, eocd]) {
    archive.set(part, position)
    position += part.length
  }
  return archive
}

export const looksLikeZipArchive = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = view.getUint32(0, true)
  // A local-file header start, or an empty-archive EOCD, or a spanned marker.
  return signature === ZIP_LOCAL_HEADER_SIGNATURE || signature === ZIP_EOCD_SIGNATURE || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07)
}

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lowest = Math.max(0, bytes.length - ZIP_EOCD_FIXED_LENGTH - ZIP_EOCD_COMMENT_LIMIT)
  for (let position = bytes.length - ZIP_EOCD_FIXED_LENGTH; position >= lowest; position -= 1) {
    if (view.getUint32(position, true) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(position + 20, true)
    if (position + ZIP_EOCD_FIXED_LENGTH + commentLength === bytes.length) return position
  }
  throw new ZipArchiveError('不是有效的 zip 压缩包')
}

export const listZipArchiveEntries = (bytes: Uint8Array): ZipArchiveEntry[] => {
  if (bytes.length < ZIP_EOCD_FIXED_LENGTH) throw new ZipArchiveError('不是有效的 zip 压缩包')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(bytes)
  const count = view.getUint16(eocd + 10, true)
  let position = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries: ZipArchiveEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > bytes.length || view.getUint32(position, true) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
      throw new ZipArchiveError('zip 中央目录损坏')
    }
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const commentLength = view.getUint16(position + 32, true)
    entries.push({
      name: decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength)),
      method: view.getUint16(position + 10, true),
      crc: view.getUint32(position + 16, true),
      compressedSize: view.getUint32(position + 20, true),
      uncompressedSize: view.getUint32(position + 24, true),
      localHeaderOffset: view.getUint32(position + 42, true),
    })
    position += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const defaultInflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  // The DOM lib types DecompressionStream's writable as BufferSource, which
  // pipeThrough rejects for a Uint8Array source — narrow the constructor to
  // the byte-typed pair we actually pipe through.
  const ctor = (globalThis as { DecompressionStream?: new (format: string) => ReadableWritablePair<Uint8Array, Uint8Array> }).DecompressionStream
  if (!ctor) throw new ZipArchiveError('当前环境不支持 deflate 解压')
  // Built from node/web streams directly — a Blob-based detour would mix
  // realms where only some of the three pieces are platform-provided.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const stream = source.pipeThrough(new ctor('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const readZipArchiveEntry = async (
  bytes: Uint8Array,
  entryName: string,
  options: { inflateRaw?: (data: Uint8Array) => Promise<Uint8Array> } = {},
): Promise<Uint8Array> => {
  const entry = listZipArchiveEntries(bytes).find((candidate) => candidate.name === entryName)
  if (!entry) throw new ZipArchiveError(`压缩包中没有条目 ${entryName}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = entry.localHeaderOffset
  if (header + 30 > bytes.length || view.getUint32(header, true) !== ZIP_LOCAL_HEADER_SIGNATURE) {
    throw new ZipArchiveError('zip 条目头损坏')
  }
  const dataStart = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true)
  if (dataStart + entry.compressedSize > bytes.length) throw new ZipArchiveError('zip 条目数据越界')
  const stored = bytes.subarray(dataStart, dataStart + entry.compressedSize)
  let data: Uint8Array
  if (entry.method === 0) {
    // A copy, not the subarray view: callers may hold the result past the
    // source buffer's lifetime, and standalone arrays compare predictably.
    data = stored.slice()
  } else if (entry.method === 8) {
    data = await (options.inflateRaw ?? defaultInflateRaw)(stored)
  } else {
    throw new ZipArchiveError(`不支持的压缩方式(${entry.method})`)
  }
  if (crc32(data) !== entry.crc) throw new ZipArchiveError('zip 条目校验失败')
  if (entry.uncompressedSize !== 0xffffffff && data.length !== entry.uncompressedSize) {
    throw new ZipArchiveError('zip 条目长度不符')
  }
  return data
}
