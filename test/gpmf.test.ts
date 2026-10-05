import { describe, expect, test } from 'vitest'
import { parseGpmf } from '../src/telemetry/gpmf'

/** Builds a KLV entry: key, type, struct size, repeat, then data padded to 4 bytes. */
function klv(key: string, type: string, structSize: number, repeat: number, data: Uint8Array): Uint8Array {
  const padded = Math.ceil(data.length / 4) * 4
  const out = new Uint8Array(8 + padded)
  for (let i = 0; i < 4; i++) out[i] = key.charCodeAt(i)
  out[4] = type === '\0' ? 0 : type.charCodeAt(0)
  out[5] = structSize
  new DataView(out.buffer).setUint16(6, repeat)
  out.set(data, 8)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function int32s(...values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 4)
  values.forEach((v, i) => new DataView(b.buffer).setInt32(i * 4, v))
  return b
}

function nest(key: string, ...children: Uint8Array[]): Uint8Array {
  const body = concat(...children)
  return klv(key, '\0', 4, body.length / 4, body)
}

describe('parseGpmf', () => {
  test('reads scaled GPS5 rows', () => {
    const scal = klv('SCAL', 'l', 4, 5, int32s(10000000, 10000000, 1000, 1000, 100))
    const gpsf = klv('GPSF', 'L', 4, 1, int32s(3))
    const gps5 = klv('GPS5', 'l', 20, 2, int32s(331265150, -1173271676, -17228, 12210, 1300, 331265160, -1173271680, -17000, 13000, 1400))
    const data = nest('DEVC', nest('STRM', gpsf, scal, gps5))
    const { gps } = parseGpmf(new DataView(data.buffer))
    expect(gps).toHaveLength(2)
    expect(gps[0].lat).toBeCloseTo(33.126515, 6)
    expect(gps[0].lon).toBeCloseTo(-117.3271676, 6)
    expect(gps[0].alt).toBeCloseTo(-17.228, 3)
    expect(gps[0].speed).toBeCloseTo(12.21, 3)
  })

  test('skips GPS5 rows without a fix', () => {
    const gpsf = klv('GPSF', 'L', 4, 1, int32s(0))
    const gps5 = klv('GPS5', 'l', 20, 1, int32s(1, 2, 3, 4, 5))
    const data = nest('DEVC', nest('STRM', gpsf, gps5))
    expect(parseGpmf(new DataView(data.buffer)).gps).toHaveLength(0)
  })
})
