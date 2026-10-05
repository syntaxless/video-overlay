// Minimal MP4 reader that finds the GoPro metadata track ('gpmd') and returns
// where each of its samples lives in the file. Reads only the boxes it needs,
// so multi-GB files are never loaded into memory.

export interface MetadataSample {
  /** Start time in seconds from the start of the video. */
  time: number
  /** Duration in seconds. */
  duration: number
  offset: number
  size: number
}

interface Box {
  type: string
  start: number
  headerSize: number
  size: number
}

async function readBytes(file: Blob, start: number, length: number): Promise<DataView> {
  const buf = await file.slice(start, start + length).arrayBuffer()
  return new DataView(buf)
}

function fourcc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  )
}

/** Lists the top-level boxes of the file without reading their payloads. */
async function listTopLevel(file: Blob): Promise<Box[]> {
  const boxes: Box[] = []
  let pos = 0
  while (pos + 8 <= file.size) {
    const head = await readBytes(file, pos, 16)
    let size = head.getUint32(0)
    const type = fourcc(head, 4)
    let headerSize = 8
    if (size === 1) {
      size = Number(head.getBigUint64(8))
      headerSize = 16
    } else if (size === 0) {
      size = file.size - pos
    }
    if (size < headerSize) break
    boxes.push({ type, start: pos, headerSize, size })
    pos += size
  }
  return boxes
}

/** Lists child boxes inside an in-memory buffer between start and end. */
function listChildren(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let pos = start
  while (pos + 8 <= end) {
    let size = view.getUint32(pos)
    const type = fourcc(view, pos + 4)
    let headerSize = 8
    if (size === 1) {
      size = Number(view.getBigUint64(pos + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < headerSize || pos + size > end) break
    boxes.push({ type, start: pos, headerSize, size })
    pos += size
  }
  return boxes
}

function findPath(view: DataView, parent: Box, path: string[]): Box | undefined {
  let current: Box | undefined = parent
  for (const type of path) {
    if (!current) return undefined
    current = listChildren(view, current.start + current.headerSize, current.start + current.size).find(
      (b) => b.type === type,
    )
  }
  return current
}

function payload(box: Box): number {
  return box.start + box.headerSize
}

function isGpmdTrack(view: DataView, trak: Box): boolean {
  const stsd = findPath(view, trak, ['mdia', 'minf', 'stbl', 'stsd'])
  if (!stsd) return false
  // stsd: version/flags (4), entry count (4), then first entry: size (4) + format (4)
  return fourcc(view, payload(stsd) + 12) === 'gpmd'
}

function readTimescale(view: DataView, trak: Box): number {
  const mdhd = findPath(view, trak, ['mdia', 'mdhd'])!
  const p = payload(mdhd)
  const version = view.getUint8(p)
  return version === 1 ? view.getUint32(p + 20) : view.getUint32(p + 12)
}

function readSampleTable(view: DataView, trak: Box, timescale: number): MetadataSample[] {
  const stbl = findPath(view, trak, ['mdia', 'minf', 'stbl'])!
  const kids = listChildren(view, payload(stbl), stbl.start + stbl.size)
  const get = (t: string) => kids.find((b) => b.type === t)

  // Sample sizes
  const stsz = get('stsz')!
  let p = payload(stsz)
  const fixedSize = view.getUint32(p + 4)
  const count = view.getUint32(p + 8)
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(fixedSize || view.getUint32(p + 12 + i * 4))

  // Chunk offsets (32 or 64 bit)
  const chunkOffsets: number[] = []
  const stco = get('stco')
  const co64 = get('co64')
  if (stco) {
    p = payload(stco)
    const n = view.getUint32(p + 4)
    for (let i = 0; i < n; i++) chunkOffsets.push(view.getUint32(p + 8 + i * 4))
  } else if (co64) {
    p = payload(co64)
    const n = view.getUint32(p + 4)
    for (let i = 0; i < n; i++) chunkOffsets.push(Number(view.getBigUint64(p + 8 + i * 8)))
  }

  // Samples per chunk
  const stsc = get('stsc')!
  p = payload(stsc)
  const stscEntries: { firstChunk: number; perChunk: number }[] = []
  const nStsc = view.getUint32(p + 4)
  for (let i = 0; i < nStsc; i++) {
    stscEntries.push({ firstChunk: view.getUint32(p + 8 + i * 12), perChunk: view.getUint32(p + 12 + i * 12) })
  }

  // Durations
  const stts = get('stts')!
  p = payload(stts)
  const durations: number[] = []
  const nStts = view.getUint32(p + 4)
  for (let i = 0; i < nStts; i++) {
    const n = view.getUint32(p + 8 + i * 8)
    const delta = view.getUint32(p + 12 + i * 8)
    for (let j = 0; j < n; j++) durations.push(delta)
  }

  const samples: MetadataSample[] = []
  let sampleIndex = 0
  let time = 0
  for (let chunk = 0; chunk < chunkOffsets.length && sampleIndex < count; chunk++) {
    let entry = stscEntries[0]
    for (const e of stscEntries) if (e.firstChunk <= chunk + 1) entry = e
    let offset = chunkOffsets[chunk]
    for (let s = 0; s < entry.perChunk && sampleIndex < count; s++) {
      const size = sizes[sampleIndex]
      const duration = (durations[sampleIndex] ?? durations[durations.length - 1] ?? 0) / timescale
      samples.push({ time, duration, offset, size })
      time += duration
      offset += size
      sampleIndex++
    }
  }
  return samples
}

/** Returns the GoPro metadata samples of the file, or an empty list if it has none. */
export async function findGpmdSamples(file: Blob): Promise<MetadataSample[]> {
  const moov = (await listTopLevel(file)).find((b) => b.type === 'moov')
  if (!moov) throw new Error('Not an MP4/MOV file (no moov box found).')
  const view = await readBytes(file, moov.start, moov.size)
  const root: Box = { type: 'moov', start: 0, headerSize: moov.headerSize, size: moov.size }
  const trak = listChildren(view, root.headerSize, root.size).find(
    (b) => b.type === 'trak' && isGpmdTrack(view, b),
  )
  if (!trak) return []
  return readSampleTable(view, trak, readTimescale(view, trak))
}

export async function readSample(file: Blob, sample: MetadataSample): Promise<DataView> {
  return readBytes(file, sample.offset, sample.size)
}

