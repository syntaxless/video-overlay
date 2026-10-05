// Weather and terrain elevation from Open-Meteo (https://open-meteo.com):
// free, no API key, and only the route's coordinates and time are sent.

import { pickRoutePoints } from './derive'
import type { Telemetry } from './types'

export interface Weather {
  /** °C */
  temperature: number
  /** WMO weather interpretation code. */
  code: number
  /** km/h */
  windSpeed: number
  /** Degrees the wind is coming from. */
  windDirection: number
}

type Fetch = typeof fetch

const DAY = 86400

/**
 * Looks up the weather for the hour the drive started, at its first GPS position.
 * Recent dates use the forecast API (which keeps about three months of past
 * data); older ones use the historical archive.
 */
export async function fetchWeather(t: Telemetry, fetchFn: Fetch = fetch): Promise<Weather | undefined> {
  const first = t.samples.find((s) => s.lat !== undefined && s.lon !== undefined)
  if (!first || t.startTime === undefined) return undefined
  const when = t.startTime + first.t
  const date = new Date(when * 1000).toISOString().slice(0, 10)
  const recent = Date.now() / 1000 - when < 80 * DAY
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive'
  const params = new URLSearchParams({
    latitude: first.lat!.toFixed(4),
    longitude: first.lon!.toFixed(4),
    hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
    start_date: date,
    end_date: date,
    timezone: 'GMT',
  })
  const res = await fetchFn(`${base}?${params}`)
  if (!res.ok) return undefined
  const data = (await res.json()) as {
    hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[]; wind_speed_10m: number[]; wind_direction_10m: number[] }
  }
  const h = data.hourly
  if (!h?.time?.length) return undefined
  // Nearest hour to the start of the drive.
  let best = 0
  for (let i = 1; i < h.time.length; i++) {
    if (Math.abs(Date.parse(h.time[i] + 'Z') / 1000 - when) < Math.abs(Date.parse(h.time[best] + 'Z') / 1000 - when)) best = i
  }
  if (h.temperature_2m[best] == null) return undefined
  return {
    temperature: h.temperature_2m[best],
    code: h.weather_code[best],
    windSpeed: h.wind_speed_10m[best],
    windDirection: h.wind_direction_10m[best],
  }
}

/**
 * GoPro altitude is measured against the GPS ellipsoid, which can be tens of
 * metres off sea level. Compares it with terrain height (Copernicus 90 m DEM)
 * at up to 100 points along the route and returns the average correction.
 * The GPS shape is kept, since the DEM is too coarse for road-level detail.
 */
export async function fetchAltitudeOffset(t: Telemetry, fetchFn: Fetch = fetch): Promise<number | undefined> {
  const points = pickRoutePoints(t, 100)
  if (points.length === 0) return undefined
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat!.toFixed(5)).join(','),
    longitude: points.map((p) => p.lon!.toFixed(5)).join(','),
  })
  const res = await fetchFn(`https://api.open-meteo.com/v1/elevation?${params}`)
  if (!res.ok) return undefined
  const { elevation } = (await res.json()) as { elevation?: number[] }
  if (!elevation || elevation.length !== points.length) return undefined
  // The median ignores the odd point where the DEM catches a cliff or bridge.
  const diffs = elevation.map((e, i) => e - points[i].alt!).sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

/** Short description of a WMO weather code. */
export function describeWeather(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow'
  if (code >= 95) return 'Thunderstorm'
  return 'Cloudy'
}
