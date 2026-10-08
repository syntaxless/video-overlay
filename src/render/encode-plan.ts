/** One way of configuring the video encoder for an export. */
export interface EncodeAttempt {
  width: number
  height: number
  /** Caps the output frame rate; undefined keeps the source rate. */
  frameRate?: number
  /** Asks for a plain target bitrate instead of constant-quantizer encoding. */
  preferBitrate: boolean
  hardwareAcceleration: 'no-preference' | 'prefer-software'
}

/**
 * Encoder settings to try, best first. Browsers can say a configuration is
 * supported and then reject it when the encoder actually starts ("Unsupported
 * configuration parameters"), typically because the hardware encoder can't do
 * constant-quantizer mode, or the frame size or frame rate is past what the
 * H.264 encoder handles (5.3K or 120+ fps GoPro footage). Each step drops one
 * of those, ending at 1080p60 in software, which every Chrome/Edge can encode.
 */
export function encodeAttempts(width: number, height: number, sourceFps: number): EncodeAttempt[] {
  const full = fitWithin(width, height, Infinity, Infinity)
  const attempts: EncodeAttempt[] = [
    { ...full, preferBitrate: false, hardwareAcceleration: 'no-preference' },
    { ...full, preferBitrate: true, hardwareAcceleration: 'no-preference' },
    { ...full, preferBitrate: true, hardwareAcceleration: 'prefer-software' },
  ]
  const frameRate = sourceFps > 61 ? 60 : undefined
  for (const [maxW, maxH] of [[3840, 2160], [1920, 1080]]) {
    const size = fitWithin(width, height, maxW, maxH)
    for (const hardwareAcceleration of ['no-preference', 'prefer-software'] as const) {
      attempts.push({ ...size, frameRate, preferBitrate: true, hardwareAcceleration })
    }
  }
  const seen = new Set<string>()
  return attempts.filter((a) => {
    const key = JSON.stringify(a)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Scales down (never up) to fit the box, keeping aspect ratio and even dimensions. */
export function fitWithin(width: number, height: number, maxW: number, maxH: number): { width: number; height: number } {
  // Compare long side to long side so portrait clips are handled the same way.
  const [boxW, boxH] = width >= height ? [maxW, maxH] : [maxH, maxW]
  const scale = Math.min(1, boxW / width, boxH / height)
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

/** True for errors that mean the encoder rejected its settings, so another configuration might work. */
export function isEncoderConfigError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | undefined
  if (err?.name === 'NotSupportedError') return true
  return /unsupported configuration|encoder configuration|not supported in this environment|encoder (creation|initialization) error/i.test(
    err?.message ?? '',
  )
}
