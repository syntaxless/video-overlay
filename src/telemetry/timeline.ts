import { CHANNELS, sampleAt, type Sample, type Telemetry } from './types'

/** Braking starts to show above this deceleration (m/s²); lifting off the throttle alone is usually below it. */
const BRAKE_START = 1.0
/** Deceleration (m/s²) shown as a full brake bar. About 0.6 g, a hard stop on the street. */
const BRAKE_FULL = 6.0

/**
 * Estimates braking from how quickly speed drops, for cars that don't report
 * brake over OBD-II. Speed is smoothed over about one second first because
 * GPS speed is noisy.
 */
export function estimateBrake(t: Telemetry): Telemetry {
  const s = t.samples.filter((x) => x.speed !== undefined)
  const out: Sample[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    let k = i
    while (j > 0 && s[i].t - s[j - 1].t <= 0.5) j--
    while (k < s.length - 1 && s[k + 1].t - s[i].t <= 0.5) k++
    const dt = s[k].t - s[j].t
    const decel = dt > 0 ? (s[j].speed! - s[k].speed!) / dt : 0
    const brake = Math.min(Math.max((decel - BRAKE_START) / (BRAKE_FULL - BRAKE_START), 0), 1) * 100
    out.push({ t: s[i].t, brake })
  }
  return { source: 'estimated from deceleration', samples: out }
}

export interface Timeline {
  /** Telemetry recorded with the video (GoPro), on video time. */
  video?: Telemetry
  /** An external log, placed on video time by `offset`. */
  log?: Telemetry
  /** Seconds to add to log time to get video time. */
  offset: number
  /** Brake estimated from deceleration, used when no brake channel exists. */
  brakeEstimate?: Telemetry
}

/**
 * Builds the timeline. The log's speed wins over GPS because OBD speed is
 * smoother; position and altitude come from the video's GPS.
 */
export function buildTimeline(video: Telemetry | undefined, log: Telemetry | undefined, offset: number): Timeline {
  const hasBrake = [video, log].some((t) => t?.samples.some((s) => s.brake !== undefined))
  let brakeEstimate: Telemetry | undefined
  if (!hasBrake) {
    // Estimate from the denser speed source, shifted onto video time.
    const source = video?.samples.some((s) => s.speed !== undefined) ? video : log
    if (source) {
      const est = estimateBrake(source)
      brakeEstimate =
        source === log ? { ...est, samples: est.samples.map((s) => ({ ...s, t: s.t + offset })) } : est
    }
  }
  return { video, log, offset, brakeEstimate }
}

/** Everything known at video time t. */
export function readingAt(timeline: Timeline, t: number): Sample {
  const out: Sample = { t }
  const fromVideo = timeline.video && sampleAt(timeline.video, t)
  const fromLog = timeline.log && inRange(timeline.log, t - timeline.offset) ? sampleAt(timeline.log, t - timeline.offset) : undefined
  for (const k of CHANNELS) {
    const preferLog = k !== 'lat' && k !== 'lon' && k !== 'alt'
    const a = preferLog ? fromLog?.[k] : fromVideo?.[k]
    const b = preferLog ? fromVideo?.[k] : fromLog?.[k]
    if (a !== undefined || b !== undefined) out[k] = a ?? b
  }
  if (out.brake === undefined && timeline.brakeEstimate) out.brake = sampleAt(timeline.brakeEstimate, t)?.brake
  return out
}

/** A log only applies while it was recording, not held at its ends. */
function inRange(t: Telemetry, time: number): boolean {
  const s = t.samples
  return s.length > 0 && time >= s[0].t && time <= s[s.length - 1].t
}
