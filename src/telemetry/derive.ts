import type { Sample, Telemetry } from './types'

const EARTH_RADIUS = 6371000

/** Initial bearing from a to b in degrees clockwise from north. */
function bearing(a: Sample, b: Sample): number {
  const φ1 = (a.lat! * Math.PI) / 180
  const φ2 = (b.lat! * Math.PI) / 180
  const Δλ = ((b.lon! - a.lon!) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function distance(a: Sample, b: Sample): number {
  const φ1 = (a.lat! * Math.PI) / 180
  const φ2 = (b.lat! * Math.PI) / 180
  const dφ = φ2 - φ1
  const dλ = ((b.lon! - a.lon!) * Math.PI) / 180
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h))
}

/** Moving average of a channel over ±halfWindow seconds. */
function smooth(samples: Sample[], key: 'alt', halfWindow: number): (number | undefined)[] {
  const out: (number | undefined)[] = []
  let lo = 0
  let hi = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < samples.length; i++) {
    while (hi < samples.length && samples[hi].t <= samples[i].t + halfWindow) {
      const v = samples[hi][key]
      if (v !== undefined) {
        sum += v
        n++
      }
      hi++
    }
    while (samples[lo].t < samples[i].t - halfWindow) {
      const v = samples[lo][key]
      if (v !== undefined) {
        sum -= v
        n--
      }
      lo++
    }
    out.push(n > 0 ? sum / n : undefined)
  }
  return out
}

/** Below this speed (m/s) GPS position jitter makes the direction meaningless, so heading is held. */
const MIN_HEADING_SPEED = 2
/** Heading is measured over at least this distance (m) to steady it. */
const HEADING_BASELINE = 8

/**
 * Adds smoothed altitude and direction of travel to GPS telemetry. Heading is
 * unwrapped so it never jumps between 359° and 0°.
 */
export function deriveGps(t: Telemetry, altitudeOffset = 0): Telemetry {
  const s = t.samples.filter((x) => x.lat !== undefined && x.lon !== undefined)
  const alt = smooth(s, 'alt', 1)
  const out: Sample[] = []
  let last: number | undefined
  let j = 0
  for (let i = 0; i < s.length; i++) {
    // Look back far enough to cover the baseline distance.
    while (j < i - 1 && distance(s[j + 1], s[i]) >= HEADING_BASELINE) j++
    let heading = last
    if ((s[i].speed ?? MIN_HEADING_SPEED) >= MIN_HEADING_SPEED && j < i && distance(s[j], s[i]) >= HEADING_BASELINE / 2) {
      const raw = bearing(s[j], s[i])
      if (last === undefined) heading = raw
      else {
        const delta = ((raw - (last % 360) + 540) % 360) - 180
        heading = last + delta
      }
    }
    last = heading
    out.push({
      t: s[i].t,
      lat: s[i].lat,
      lon: s[i].lon,
      alt: alt[i] !== undefined ? alt[i]! + altitudeOffset : undefined,
      heading,
    })
  }
  // Before the first movement, use the first heading found.
  const first = out.find((x) => x.heading !== undefined)?.heading
  for (const x of out) {
    if (x.heading !== undefined) break
    x.heading = first
  }
  return { source: `${t.source} (derived)`, samples: out, startTime: t.startTime }
}

/** Evenly spaced positions along the route, at most `count`, for elevation lookups. */
export function pickRoutePoints(t: Telemetry, count: number): Sample[] {
  const s = t.samples.filter((x) => x.lat !== undefined && x.lon !== undefined && x.alt !== undefined)
  if (s.length <= count) return s
  return Array.from({ length: count }, (_, i) => s[Math.round((i * (s.length - 1)) / (count - 1))])
}
