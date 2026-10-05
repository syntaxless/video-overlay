/** One telemetry reading on the video's timeline. */
export interface Sample {
  /** Seconds from the start of the video. */
  t: number
  lat?: number
  lon?: number
  /** Metres. */
  alt?: number
  /** Metres per second. */
  speed?: number
}

export interface Telemetry {
  source: string
  samples: Sample[]
}

type NumericKey = 'lat' | 'lon' | 'alt' | 'speed'
const KEYS: NumericKey[] = ['lat', 'lon', 'alt', 'speed']

/** Returns the reading at time t, linearly interpolated between the nearest samples. */
export function sampleAt(telemetry: Telemetry, t: number): Sample | undefined {
  const s = telemetry.samples
  if (s.length === 0) return undefined
  if (t <= s[0].t) return { ...s[0], t }
  if (t >= s[s.length - 1].t) return { ...s[s.length - 1], t }
  let lo = 0
  let hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  const f = (t - a.t) / (b.t - a.t)
  const out: Sample = { t }
  for (const k of KEYS) {
    const va = a[k]
    const vb = b[k]
    if (va !== undefined && vb !== undefined) out[k] = va + (vb - va) * f
    else out[k] = va ?? vb
  }
  return out
}
