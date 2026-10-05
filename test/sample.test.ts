import { describe, expect, test } from 'vitest'
import { sampleAt, type Telemetry } from '../src/telemetry/types'

describe('sampleAt', () => {
  const t: Telemetry = {
    source: 'test',
    samples: [
      { t: 0, speed: 0, alt: 100 },
      { t: 1, speed: 10, alt: 110 },
      { t: 2, speed: 20 },
    ],
  }

  test('interpolates between readings', () => {
    expect(sampleAt(t, 0.5)?.speed).toBeCloseTo(5)
    expect(sampleAt(t, 0.5)?.alt).toBeCloseTo(105)
  })

  test('holds the first and last readings outside the range', () => {
    expect(sampleAt(t, -1)?.speed).toBe(0)
    expect(sampleAt(t, 5)?.speed).toBe(20)
  })

  test('returns undefined with no readings', () => {
    expect(sampleAt({ source: 'x', samples: [] }, 1)).toBeUndefined()
  })
})
