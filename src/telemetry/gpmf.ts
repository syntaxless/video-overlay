// Parser for GoPro's GPMF (KLV) telemetry payloads.
// Spec: https://github.com/gopro/gpmf-parser
// Extracts GPS (GPS5 on HERO5-HERO10, GPS9 on HERO11+) and the accelerometer.

export interface GpsFix {
  lat: number
  lon: number
  /** Metres above the WGS84 ellipsoid. */
  alt: number
  /** Ground speed in m/s. */
  speed: number
}

export interface GpmfPayload {
  gps: GpsFix[]
  /** Accelerometer readings in m/s², as reported by the camera ([axis0, axis1, axis2]). */
  accel: [number, number, number][]
}

interface Klv {
  key: string
  type: string
  structSize: number
  repeat: number
  dataStart: number
  dataLength: number
}

const TYPE_SIZES: Record<string, number> = {
  b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, d: 8, j: 8, J: 8, q: 4, Q: 8, F: 4, G: 16, U: 16,
}

function readKlvs(view: DataView, start: number, end: number): Klv[] {
  const out: Klv[] = []
  let pos = start
  while (pos + 8 <= end) {
    const key = String.fromCharCode(
      view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3),
    )
    const type = String.fromCharCode(view.getUint8(pos + 4))
    const structSize = view.getUint8(pos + 5)
    const repeat = view.getUint16(pos + 6)
    const dataLength = structSize * repeat
    if (key === '\0\0\0\0') break
    out.push({ key, type, structSize, repeat, dataStart: pos + 8, dataLength })
    // Payloads are padded to a 4-byte boundary.
    pos += 8 + Math.ceil(dataLength / 4) * 4
  }
  return out
}

function readNumber(view: DataView, type: string, at: number): number {
  switch (type) {
    case 'b': return view.getInt8(at)
    case 'B': return view.getUint8(at)
    case 's': return view.getInt16(at)
    case 'S': return view.getUint16(at)
    case 'l': return view.getInt32(at)
    case 'L': return view.getUint32(at)
    case 'f': return view.getFloat32(at)
    case 'd': return view.getFloat64(at)
    case 'j': return Number(view.getBigInt64(at))
    case 'J': return Number(view.getBigUint64(at))
    default: throw new Error(`Unsupported GPMF number type '${type}'`)
  }
}

function readString(view: DataView, k: Klv): string {
  let s = ''
  for (let i = 0; i < k.dataLength; i++) s += String.fromCharCode(view.getUint8(k.dataStart + i))
  return s.replace(/\0+$/, '')
}

/** Reads a list of numbers (SCAL can be one value or one per element). */
function readNumbers(view: DataView, k: Klv): number[] {
  const size = TYPE_SIZES[k.type]
  const n = k.dataLength / size
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(readNumber(view, k.type, k.dataStart + i * size))
  return out
}

/**
 * Reads the rows of a sensor stream as scaled numbers. Handles plain numeric
 * types and the complex '?' type described by a TYPE entry (used by GPS9).
 */
function readRows(view: DataView, k: Klv, scal: number[], typeDef: string | undefined): number[][] {
  const types = k.type === '?' ? (typeDef ?? '').split('') : null
  const rows: number[][] = []
  for (let r = 0; r < k.repeat; r++) {
    const rowStart = k.dataStart + r * k.structSize
    const row: number[] = []
    if (types) {
      let at = rowStart
      for (const t of types) {
        row.push(readNumber(view, t, at))
        at += TYPE_SIZES[t]
      }
    } else {
      const size = TYPE_SIZES[k.type]
      for (let i = 0; i < k.structSize / size; i++) row.push(readNumber(view, k.type, rowStart + i * size))
    }
    rows.push(row.map((v, i) => v / (scal.length > 1 ? scal[i] ?? 1 : scal[0] ?? 1)))
  }
  return rows
}

/** Parses one gpmd sample (usually one second of telemetry). */
export function parseGpmf(view: DataView): GpmfPayload {
  const result: GpmfPayload = { gps: [], accel: [] }
  for (const devc of readKlvs(view, 0, view.byteLength)) {
    if (devc.key !== 'DEVC') continue
    for (const strm of readKlvs(view, devc.dataStart, devc.dataStart + devc.dataLength)) {
      if (strm.key !== 'STRM') continue
      let scal: number[] = [1]
      let typeDef: string | undefined
      let gpsFix = 3
      for (const k of readKlvs(view, strm.dataStart, strm.dataStart + strm.dataLength)) {
        if (k.key === 'SCAL') scal = readNumbers(view, k)
        else if (k.key === 'TYPE') typeDef = readString(view, k)
        else if (k.key === 'GPSF') gpsFix = readNumber(view, k.type, k.dataStart)
        else if (k.key === 'GPS5') {
          if (gpsFix < 2) continue
          for (const [lat, lon, alt, speed] of readRows(view, k, scal, typeDef)) {
            result.gps.push({ lat, lon, alt, speed })
          }
        } else if (k.key === 'GPS9') {
          // lat, lon, alt, 2D speed, 3D speed, days, secs, DOP, fix
          for (const row of readRows(view, k, scal, typeDef)) {
            if ((row[8] ?? 3) < 2) continue
            result.gps.push({ lat: row[0], lon: row[1], alt: row[2], speed: row[3] })
          }
        } else if (k.key === 'ACCL') {
          for (const [a, b, c] of readRows(view, k, scal, typeDef)) result.accel.push([a, b, c])
        }
      }
    }
  }
  return result
}
