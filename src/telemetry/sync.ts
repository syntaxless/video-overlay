import { sampleAt, type Telemetry } from './types'

export interface SyncResult {
  /** Add to the log's time to get video time. */
  offset: number
  /** Pearson correlation of the two speed traces at that offset, -1 to 1. */
  score: number
}

/** Speed resampled at a fixed rate, NaN where there is no reading. */
function resampleSpeed(t: Telemetry, hz: number): Float64Array {
  const s = t.samples.filter((x) => x.speed !== undefined)
  if (s.length === 0) return new Float64Array()
  const end = s[s.length - 1].t
  const out = new Float64Array(Math.floor(end * hz) + 1)
  const speedOnly: Telemetry = { source: '', samples: s }
  for (let i = 0; i < out.length; i++) out[i] = sampleAt(speedOnly, i / hz)!.speed!
  return out
}

/** Correlation of a[i] with b[i - shift] over their overlap. */
function correlate(a: Float64Array, b: Float64Array, shift: number, minOverlap: number): number {
  const start = Math.max(0, shift)
  const end = Math.min(a.length, b.length + shift)
  const n = end - start
  if (n < minOverlap) return -Infinity
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
  for (let i = start; i < end; i++) {
    const x = a[i]
    const y = b[i - shift]
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y
  }
  const cov = sab - (sa * sb) / n
  const va = saa - (sa * sa) / n
  const vb = sbb - (sb * sb) / n
  // A flat trace (car parked) can't be matched.
  if (va < 1e-6 * n || vb < 1e-6 * n) return -Infinity
  return cov / Math.sqrt(va * vb)
}

function bestShift(a: Float64Array, b: Float64Array, from: number, to: number, minOverlap: number) {
  let best = { shift: 0, score: -Infinity }
  for (let shift = from; shift <= to; shift++) {
    const score = correlate(a, b, shift, minOverlap)
    if (score > best.score) best = { shift, score }
  }
  return best
}

/** Averages blocks of `factor` samples, so the coarse search sees smoothed speed rather than aliased spot readings. */
function downsample(a: Float64Array, factor: number): Float64Array {
  const out = new Float64Array(Math.floor(a.length / factor))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let j = 0; j < factor; j++) sum += a[i * factor + j]
    out[i] = sum / factor
  }
  return out
}

const FINE_HZ = 10
const COARSE_FACTOR = 10 // 1 Hz
const CANDIDATES = 5

/**
 * Finds how far to shift a data log so its speed lines up with the video's
 * own speed (GoPro GPS). Searches every shift at 1 Hz, then refines the few
 * best candidates at 10 Hz. Returns undefined when either side has no usable speed.
 */
export function findOffset(video: Telemetry, log: Telemetry): SyncResult | undefined {
  const fineA = resampleSpeed(video, FINE_HZ)
  const fineB = resampleSpeed(log, FINE_HZ)
  const coarseA = downsample(fineA, COARSE_FACTOR)
  const coarseB = downsample(fineB, COARSE_FACTOR)
  if (coarseA.length < 5 || coarseB.length < 5) return undefined
  // Require the traces to overlap for half the shorter one (5 to 30 s), so a
  // short accidental match at the edges can't win.
  const overlapSeconds = Math.max(5, Math.min(30, Math.floor(Math.min(coarseA.length, coarseB.length) * 0.5)))

  const coarse: { shift: number; score: number }[] = []
  for (let shift = -(coarseB.length - 5); shift <= coarseA.length - 5; shift++) {
    const score = correlate(coarseA, coarseB, shift, overlapSeconds)
    if (Number.isFinite(score)) coarse.push({ shift, score })
  }
  if (coarse.length === 0) return undefined
  coarse.sort((a, b) => b.score - a.score)

  let best: SyncResult | undefined
  for (const c of coarse.slice(0, CANDIDATES)) {
    const center = c.shift * COARSE_FACTOR
    const fine = bestShift(fineA, fineB, center - 15, center + 15, overlapSeconds * FINE_HZ)
    if (Number.isFinite(fine.score) && (!best || fine.score > best.score)) {
      best = { offset: fine.shift / FINE_HZ, score: fine.score }
    }
  }
  return best
}
