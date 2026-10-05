import { describe, expect, test } from 'vitest'
import { findOffset } from '../src/telemetry/sync'
import { buildTimeline, estimateBrake, readingAt } from '../src/telemetry/timeline'
import type { Sample, Telemetry } from '../src/telemetry/types'

/** A canyon-road-like speed profile in m/s: accelerate, brake for corners, repeat. */
function speedAt(t: number): number {
  return 15 + 8 * Math.sin(t / 7) + 4 * Math.sin(t / 2.3 + 1) + 2 * Math.sin(t / 0.9)
}

function series(from: number, to: number, hz: number, fn: (t: number) => Partial<Sample>): Telemetry {
  const samples: Sample[] = []
  for (let t = from; t <= to; t += 1 / hz) samples.push({ t: t - from, ...fn(t) })
  return { source: 'test', samples }
}

describe('findOffset', () => {
  test('finds where a log starts in the video from speed alone', () => {
    // Video covers drive time 0..300 s. The log started 42.3 s into the video
    // and runs 200 s, at 4 Hz with OBD speed reading 3% high.
    const video = series(0, 300, 18, (t) => ({ speed: speedAt(t) }))
    const log = series(42.3, 242.3, 4, (t) => ({ speed: speedAt(t) * 1.03 + 0.3 * Math.sin(t * 13) }))
    const result = findOffset(video, log)!
    expect(result.offset).toBeCloseTo(42.3, 1)
    expect(result.score).toBeGreaterThan(0.95)
  })

  test('handles a log that started before the video', () => {
    const video = series(60, 240, 18, (t) => ({ speed: speedAt(t) }))
    const log = series(0, 300, 5, (t) => ({ speed: speedAt(t) }))
    expect(findOffset(video, log)!.offset).toBeCloseTo(-60, 1)
  })

  test('gives up on a parked car', () => {
    const video = series(0, 60, 10, () => ({ speed: 0 }))
    const log = series(0, 60, 10, () => ({ speed: 0 }))
    expect(findOffset(video, log)).toBeUndefined()
  })
})

describe('brake', () => {
  test('is zero when cruising and high in a hard stop', () => {
    const cruise = series(0, 5, 10, () => ({ speed: 20 }))
    expect(Math.max(...estimateBrake(cruise).samples.map((s) => s.brake!))).toBe(0)
    const stop = series(0, 3, 10, (t) => ({ speed: Math.max(0, 20 - 7 * t) }))
    expect(estimateBrake(stop).samples[5].brake).toBeGreaterThan(90)
  })
})

describe('readingAt', () => {
  const video = series(0, 10, 10, (t) => ({ speed: 10, lat: 34 + t / 1000, alt: 500 }))
  const log = series(0, 5, 2, () => ({ speed: 12, rpm: 3000, throttle: 40 }))

  test('places the log at its offset and prefers its speed', () => {
    const tl = buildTimeline(video, log, 2)
    expect(readingAt(tl, 1).rpm).toBeUndefined()
    expect(readingAt(tl, 1).speed).toBeCloseTo(10)
    const r = readingAt(tl, 4)
    expect(r.rpm).toBe(3000)
    expect(r.speed).toBe(12)
    expect(r.alt).toBe(500)
  })

  test('estimates brake only when no channel has it', () => {
    expect(buildTimeline(video, log, 0).brakeEstimate).toBeDefined()
    const withBrake = { ...log, samples: log.samples.map((s) => ({ ...s, brake: 0 })) }
    expect(buildTimeline(video, withBrake, 0).brakeEstimate).toBeUndefined()
  })
})
