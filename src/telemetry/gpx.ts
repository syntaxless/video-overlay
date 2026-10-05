// GPX tracks (phones, watches, most GPS apps). Parsed with regular expressions
// rather than an XML parser so it also runs outside the browser (tests).

import type { Sample, Telemetry } from './types'

const POINT = /<(?:\w+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?trkpt>)/g

function attr(attrs: string, name: string): number | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`))
  return m ? Number(m[1]) : undefined
}

function tag(body: string, name: string): string | undefined {
  const m = body.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([^<]*)<`))
  return m?.[1].trim()
}

export function parseGpx(xml: string, source: string): Telemetry {
  const samples: Sample[] = []
  let t0: number | undefined
  for (const m of xml.matchAll(POINT)) {
    const body = m[2] ?? ''
    const time = tag(body, 'time')
    const ms = time ? Date.parse(time) : NaN
    if (Number.isNaN(ms)) continue
    t0 ??= ms / 1000
    const s: Sample = { t: ms / 1000 - t0, lat: attr(m[1], 'lat'), lon: attr(m[1], 'lon') }
    const ele = tag(body, 'ele')
    if (ele !== undefined) s.alt = Number(ele)
    // Speed lives in extensions, e.g. <gpxtpx:speed> or <speed>, in m/s.
    const speed = tag(body, 'speed')
    if (speed !== undefined && !Number.isNaN(Number(speed))) s.speed = Number(speed)
    samples.push(s)
  }
  if (samples.length === 0) throw new Error('No timed track points found in this GPX file.')
  samples.sort((a, b) => a.t - b.t)
  fillSpeedFromPositions(samples)
  return { source, samples, startTime: t0 }
}

/** Many GPX files have no speed; work it out from the distance between points. */
export function fillSpeedFromPositions(samples: Sample[]) {
  if (samples.some((s) => s.speed !== undefined)) return
  const R = 6371000
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)]
    const b = samples[Math.min(samples.length - 1, i + 1)]
    const dt = b.t - a.t
    if (dt <= 0 || a.lat === undefined || b.lat === undefined) continue
    const φ1 = (a.lat * Math.PI) / 180
    const φ2 = (b.lat * Math.PI) / 180
    const dφ = φ2 - φ1
    const dλ = ((b.lon! - a.lon!) * Math.PI) / 180
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
    samples[i].speed = (2 * R * Math.asin(Math.sqrt(h))) / dt
  }
}
