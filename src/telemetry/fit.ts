// Minimal reader for Garmin FIT activity files: pulls the "record" messages
// (time, position, altitude, speed, and heart rate when present).
// Format: https://developer.garmin.com/fit/protocol/

import { fillSpeedFromPositions } from './gpx'
import type { Sample, Telemetry } from './types'

/** FIT timestamps count seconds from 1989-12-31 00:00 UTC. */
const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000
const RECORD = 20
const SEMICIRCLE = 180 / 2 ** 31

interface FieldDef {
  num: number
  size: number
  baseType: number
}

interface Definition {
  global: number
  littleEndian: boolean
  fields: FieldDef[]
  devSize: number
}

/** Reads an unsigned or signed integer field, or undefined for FIT's "invalid" marker. */
function readField(view: DataView, at: number, f: FieldDef, le: boolean): number | undefined {
  const type = f.baseType & 0x1f
  switch (type) {
    case 0x00: case 0x02: case 0x0a: { const v = view.getUint8(at); return v === 0xff || (type === 0x0a && v === 0) ? undefined : v }
    case 0x01: { const v = view.getInt8(at); return v === 0x7f ? undefined : v }
    case 0x03: { const v = view.getInt16(at, le); return v === 0x7fff ? undefined : v }
    case 0x04: case 0x0b: { const v = view.getUint16(at, le); return v === 0xffff || (type === 0x0b && v === 0) ? undefined : v }
    case 0x05: { const v = view.getInt32(at, le); return v === 0x7fffffff ? undefined : v }
    case 0x06: case 0x0c: { const v = view.getUint32(at, le); return v === 0xffffffff || (type === 0x0c && v === 0) ? undefined : v }
    case 0x08: { const v = view.getFloat32(at, le); return Number.isFinite(v) ? v : undefined }
    default: return undefined
  }
}

export function parseFit(buffer: ArrayBuffer, source: string): Telemetry {
  const view = new DataView(buffer)
  const headerSize = view.getUint8(0)
  if (String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== '.FIT') {
    throw new Error('Not a FIT file.')
  }
  const dataEnd = Math.min(headerSize + view.getUint32(4, true), buffer.byteLength)
  const defs = new Map<number, Definition>()
  const samples: Sample[] = []
  let lastTimestamp = 0
  let pos = headerSize

  while (pos < dataEnd) {
    const header = view.getUint8(pos++)
    let local: number
    let timeOffset: number | undefined
    if (header & 0x80) {
      // Compressed timestamp header: 2-bit local type, 5-bit time offset.
      local = (header >> 5) & 0x03
      timeOffset = header & 0x1f
    } else if (header & 0x40) {
      // Definition message.
      local = header & 0x0f
      const hasDev = (header & 0x20) !== 0
      const littleEndian = view.getUint8(pos + 1) === 0
      const global = littleEndian ? view.getUint16(pos + 2, true) : view.getUint16(pos + 2, false)
      const count = view.getUint8(pos + 4)
      pos += 5
      const fields: FieldDef[] = []
      for (let i = 0; i < count; i++) {
        fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), baseType: view.getUint8(pos + 2) })
        pos += 3
      }
      let devSize = 0
      if (hasDev) {
        const devCount = view.getUint8(pos++)
        for (let i = 0; i < devCount; i++) {
          devSize += view.getUint8(pos + 1)
          pos += 3
        }
      }
      defs.set(local, { global, littleEndian, fields, devSize })
      continue
    } else {
      local = header & 0x0f
    }

    const def = defs.get(local)
    if (!def) throw new Error('Corrupt FIT file (data before its definition).')
    const values = new Map<number, number | undefined>()
    for (const f of def.fields) {
      values.set(f.num, f.size >= sizeOf(f.baseType) ? readField(view, pos, f, def.littleEndian) : undefined)
      pos += f.size
    }
    pos += def.devSize

    let timestamp = values.get(253)
    if (timestamp !== undefined) lastTimestamp = timestamp
    else if (timeOffset !== undefined) {
      // Offset is the low 5 bits of the time; roll over from the last full timestamp.
      timestamp = (lastTimestamp & ~0x1f) + timeOffset
      if (timeOffset < (lastTimestamp & 0x1f)) timestamp += 0x20
      lastTimestamp = timestamp
    }
    if (def.global !== RECORD || timestamp === undefined) continue

    const lat = values.get(0)
    const lon = values.get(1)
    const alt = values.get(78) ?? values.get(2)
    const speed = values.get(73) ?? values.get(6)
    samples.push({
      t: FIT_EPOCH + timestamp,
      lat: lat !== undefined ? lat * SEMICIRCLE : undefined,
      lon: lon !== undefined ? lon * SEMICIRCLE : undefined,
      // altitude: scale 5, offset 500 m; speed: scale 1000 (m/s)
      alt: alt !== undefined ? alt / 5 - 500 : undefined,
      speed: speed !== undefined ? speed / 1000 : undefined,
    })
  }
  if (samples.length === 0) throw new Error('No activity records found in this FIT file.')
  samples.sort((a, b) => a.t - b.t)
  const startTime = samples[0].t
  for (const s of samples) s.t -= startTime
  fillSpeedFromPositions(samples)
  return { source, samples, startTime }
}

function sizeOf(baseType: number): number {
  switch (baseType & 0x1f) {
    case 0x03: case 0x04: case 0x0b: return 2
    case 0x05: case 0x06: case 0x08: case 0x0c: return 4
    default: return 1
  }
}
