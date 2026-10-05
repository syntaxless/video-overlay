/** One telemetry reading. `t` is seconds on the source's own timeline. */
export interface Sample {
  t: number
  lat?: number
  lon?: number
  /** Metres. */
  alt?: number
  /** Metres per second. */
  speed?: number
  /** Engine revolutions per minute. */
  rpm?: number
  /** Throttle (accelerator) position, 0 to 100. */
  throttle?: number
  /** Brake pressure or pedal position, 0 to 100. */
  brake?: number
  /**
   * Direction of travel in degrees clockwise from north. Unwrapped (it can go
   * past 360 or below 0) so it interpolates smoothly; take it modulo 360 to show it.
   */
  heading?: number
}

export interface Telemetry {
  source: string
  samples: Sample[]
  /** UTC time of t = 0 in epoch seconds, when known. */
  startTime?: number
}

export type Channel = Exclude<keyof Sample, 't'>
export const CHANNELS: Channel[] = ['lat', 'lon', 'alt', 'speed', 'rpm', 'throttle', 'brake', 'heading']

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
  for (const k of CHANNELS) {
    const va = a[k]
    const vb = b[k]
    if (va !== undefined && vb !== undefined) out[k] = va + (vb - va) * f
    else if (va !== undefined || vb !== undefined) out[k] = va ?? vb
  }
  return out
}

/** True when any sample carries this channel. */
export function hasChannel(telemetry: Telemetry | undefined, channel: Channel): boolean {
  return !!telemetry?.samples.some((s) => s[channel] !== undefined)
}
