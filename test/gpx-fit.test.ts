import { describe, expect, test } from 'vitest'
import { parseFit } from '../src/telemetry/fit'
import { parseGpx } from '../src/telemetry/gpx'

describe('GPX', () => {
  test('reads points, elevation and extension speed', () => {
    const t = parseGpx(
      `<?xml version="1.0"?>
      <gpx version="1.1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">
        <trk><trkseg>
          <trkpt lat="34.2000" lon="-118.1000"><ele>500.5</ele><time>2026-10-05T14:22:00Z</time>
            <extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>12.5</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>
          <trkpt lat='34.2001' lon='-118.1001'><ele>501</ele><time>2026-10-05T14:22:01.500Z</time></trkpt>
        </trkseg></trk>
      </gpx>`,
      'drive.gpx',
    )
    expect(t.samples).toHaveLength(2)
    expect(t.samples[0]).toMatchObject({ t: 0, lat: 34.2, lon: -118.1, alt: 500.5, speed: 12.5 })
    expect(t.samples[1].t).toBe(1.5)
    expect(t.startTime).toBe(Date.UTC(2026, 9, 5, 14, 22) / 1000)
  })

  test('works out speed when the file has none', () => {
    const t = parseGpx(
      `<gpx><trk><trkseg>
        <trkpt lat="34" lon="-118"><time>2026-10-05T14:22:00Z</time></trkpt>
        <trkpt lat="34.0001" lon="-118"><time>2026-10-05T14:22:01Z</time></trkpt>
      </trkseg></trk></gpx>`,
      'x.gpx',
    )
    // 0.0001° of latitude is about 11.1 m.
    expect(t.samples[0].speed).toBeCloseTo(11.1, 1)
  })

  test('rejects a file without timed points', () => {
    expect(() => parseGpx('<gpx><wpt lat="1" lon="2"/></gpx>', 'x')).toThrow()
  })
})

/**
 * Writes a FIT file per the public protocol: 14-byte header, a definition for
 * "record" messages, then data messages (one with a compressed timestamp header).
 */
function makeFit(): ArrayBuffer {
  const bytes: number[] = []
  const u8 = (v: number) => bytes.push(v & 0xff)
  const u16 = (v: number) => { u8(v); u8(v >> 8) }
  const u32 = (v: number) => { u16(v); u16(v >>> 16) }
  const i32 = (v: number) => u32(v >>> 0)

  // Definition, local type 0: record (20), little endian.
  u8(0x40); u8(0); u8(0); u16(20); u8(5)
  for (const [num, size, type] of [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [78, 4, 0x86], [73, 4, 0x86]]) {
    u8(num); u8(size); u8(type)
  }
  const deg = (d: number) => Math.round(d / (180 / 2 ** 31))
  const record = (ts: number | null, lat: number, lon: number, alt: number, speed: number, compressed?: number) => {
    if (compressed !== undefined) u8(0x80 | compressed)
    else u8(0x00)
    if (ts !== null) u32(ts)
    i32(deg(lat)); i32(deg(lon)); u32((alt + 500) * 5); u32(speed * 1000)
  }
  const ts = 1_100_000_000 // FIT time
  record(ts, 34.2, -118.1, 500, 12.5)
  record(ts + 1, 34.2001, -118.1, 501, 13)

  // Second definition without timestamp, used with a compressed header.
  u8(0x41); u8(0); u8(0); u16(20); u8(4)
  for (const [num, size, type] of [[0, 4, 0x85], [1, 4, 0x85], [78, 4, 0x86], [73, 4, 0x86]]) {
    u8(num); u8(size); u8(type)
  }
  // Compressed header: local type 1, time offset = low 5 bits of ts + 2.
  bytes.push(0x80 | (1 << 5) | ((ts + 2) & 0x1f))
  i32(deg(34.2002)); i32(deg(-118.1)); u32((502 + 500) * 5); u32(13500)

  const header = [14, 0x20, 0, 0, ...[0, 0, 0, 0], ...'.FIT'.split('').map((c) => c.charCodeAt(0)), 0, 0]
  const size = bytes.length
  header[4] = size & 0xff; header[5] = (size >> 8) & 0xff; header[6] = (size >> 16) & 0xff; header[7] = size >>> 24
  return new Uint8Array([...header, ...bytes, 0, 0]).buffer
}

describe('FIT', () => {
  test('reads records, scaling and compressed timestamps', () => {
    const t = parseFit(makeFit(), 'ride.fit')
    expect(t.samples.map((s) => s.t)).toEqual([0, 1, 2])
    expect(t.samples[0].lat).toBeCloseTo(34.2, 6)
    expect(t.samples[0].lon).toBeCloseTo(-118.1, 6)
    expect(t.samples[0].alt).toBeCloseTo(500)
    expect(t.samples[2].speed).toBeCloseTo(13.5)
    expect(t.startTime).toBe(Date.UTC(1989, 11, 31) / 1000 + 1_100_000_000)
  })

  test('rejects other files', () => {
    expect(() => parseFit(new Uint8Array(20).buffer, 'x')).toThrow('Not a FIT file')
  })
})
