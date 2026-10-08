import { describe, expect, test } from 'vitest'
import { encodeAttempts, fitWithin, isEncoderConfigError } from '../src/render/encode-plan'

describe('encodeAttempts', () => {
  test('starts with the source settings and ends at software 1080p60', () => {
    const attempts = encodeAttempts(5312, 2988, 119.88)
    expect(attempts[0]).toEqual({ width: 5312, height: 2988, preferBitrate: false, hardwareAcceleration: 'no-preference' })
    expect(attempts.at(-1)).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 60,
      preferBitrate: true,
      hardwareAcceleration: 'prefer-software',
    })
    expect(attempts).toContainEqual({
      width: 3840,
      height: 2160,
      frameRate: 60,
      preferBitrate: true,
      hardwareAcceleration: 'no-preference',
    })
  })

  test('has no duplicate attempts for a 1080p30 clip', () => {
    const attempts = encodeAttempts(1920, 1080, 29.97)
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.width === 1920 && a.height === 1080 && a.frameRate === undefined)).toBe(true)
  })
})

describe('fitWithin', () => {
  test('scales landscape and portrait down to even sizes, never up', () => {
    expect(fitWithin(5312, 2988, 3840, 2160)).toEqual({ width: 3840, height: 2160 })
    expect(fitWithin(2988, 5312, 3840, 2160)).toEqual({ width: 2160, height: 3840 })
    expect(fitWithin(1280, 720, 3840, 2160)).toEqual({ width: 1280, height: 720 })
    expect(fitWithin(1279, 719, Infinity, Infinity)).toEqual({ width: 1278, height: 718 })
  })
})

describe('isEncoderConfigError', () => {
  test("recognises Chrome's encoder rejections but not other failures", () => {
    expect(isEncoderConfigError(new DOMException('Unsupported configuration parameters.', 'NotSupportedError'))).toBe(true)
    expect(isEncoderConfigError(new DOMException('Encoder creation error.', 'OperationError'))).toBe(true)
    expect(isEncoderConfigError(new Error('This file has no video track.'))).toBe(false)
  })
})
