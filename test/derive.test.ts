import { describe, expect, test } from 'vitest'
import { deriveGps } from '../src/telemetry/derive'
import { describeWeather, fetchAltitudeOffset, fetchWeather } from '../src/telemetry/openmeteo'
import { compassPoint } from '../src/overlay/info'
import type { Sample, Telemetry } from '../src/telemetry/types'

const M_PER_DEG = 111_320

/** Drives a path given as [dNorth, dEast] metres per second, 10 Hz, at 15 m/s. */
function drive(legs: [number, number, number][]): Telemetry {
  const samples: Sample[] = []
  let lat = 34
  let lon = -118
  let t = 0
  for (const [seconds, north, east] of legs) {
    for (let i = 0; i < seconds * 10; i++) {
      lat += north / 10 / M_PER_DEG
      lon += east / 10 / (M_PER_DEG * Math.cos((34 * Math.PI) / 180))
      t += 0.1
      samples.push({ t, lat, lon, alt: 100 + t, speed: Math.hypot(north, east) })
    }
  }
  return { source: 'test', samples, startTime: 1_790_000_000 }
}

describe('deriveGps', () => {
  test('heading follows the direction of travel', () => {
    const d = deriveGps(drive([[5, 15, 0], [5, 0, 15]])).samples
    expect(((d[30].heading! % 360) + 360) % 360).toBeCloseTo(0, 0)
    expect(((d[90].heading! % 360) + 360) % 360).toBeCloseTo(90, 0)
  })

  test('heading unwraps instead of jumping across north', () => {
    // West (270) then turning right through north to east (450).
    const d = deriveGps(drive([[5, 0, -15], [3, 15, 0], [5, 0, 15]])).samples
    const last = d[d.length - 1].heading!
    expect(last).toBeCloseTo(450, 0)
    for (let i = 1; i < d.length; i++) expect(Math.abs(d[i].heading! - d[i - 1].heading!)).toBeLessThan(60)
  })

  test('applies the altitude offset to smoothed altitude', () => {
    const d = deriveGps(drive([[10, 15, 0]]), -20).samples
    expect(d[50].alt).toBeCloseTo(100 + 5.1 - 20, 0)
  })
})

function mockFetch(body: unknown, seen: string[]): typeof fetch {
  return (async (url: string) => {
    seen.push(url)
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
}

describe('Open-Meteo', () => {
  test('weather picks the hour nearest the start of the drive', async () => {
    const seen: string[] = []
    const t = drive([[2, 15, 0]])
    t.startTime = Date.UTC(2024, 5, 1, 14, 40) / 1000
    const w = await fetchWeather(
      t,
      mockFetch(
        {
          hourly: {
            time: ['2024-06-01T13:00', '2024-06-01T14:00', '2024-06-01T15:00'],
            temperature_2m: [20, 21, 22],
            weather_code: [0, 1, 3],
            wind_speed_10m: [5, 6, 7],
            wind_direction_10m: [90, 180, 270],
          },
        },
        seen,
      ),
    )
    expect(w).toEqual({ temperature: 22, code: 3, windSpeed: 7, windDirection: 270 })
    // A 2024 date is old enough for the archive API.
    expect(seen[0]).toContain('archive-api.open-meteo.com')
    expect(seen[0]).toContain('start_date=2024-06-01')
  })

  test('altitude offset is the median terrain difference', async () => {
    const t = drive([[1, 15, 0]])
    const n = t.samples.length
    const elevation = t.samples.map((s, i) => s.alt! - 30 + (i === 0 ? 500 : 0))
    expect(n).toBeLessThanOrEqual(100)
    expect(await fetchAltitudeOffset(t, mockFetch({ elevation }, []))).toBeCloseTo(-30)
  })

  test('no start time means no weather lookup', async () => {
    const t = drive([[1, 15, 0]])
    t.startTime = undefined
    expect(await fetchWeather(t, mockFetch({}, []))).toBeUndefined()
  })

  test('labels', () => {
    expect(describeWeather(0)).toBe('Clear')
    expect(describeWeather(63)).toBe('Rain')
    expect(compassPoint(-10)).toBe('N')
    expect(compassPoint(450)).toBe('E')
    expect(compassPoint(225)).toBe('SW')
  })
})
