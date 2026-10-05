import type { Sample } from '../telemetry/types'

export type SpeedUnit = 'mph' | 'kmh'

export interface SpeedStyle {
  unit: SpeedUnit
  /** Top of the dial, in the chosen unit. */
  max: number
}

const MPS_TO: Record<SpeedUnit, number> = { mph: 2.2369363, kmh: 3.6 }
const LABEL: Record<SpeedUnit, string> = { mph: 'MPH', kmh: 'KM/H' }

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const START = Math.PI * 0.75
const SWEEP = Math.PI * 1.5

/**
 * Draws a dial speedometer in the bottom-left corner. Sizes are relative to
 * the frame height so it looks the same at 1080p and 4K.
 */
export function drawSpeed(ctx: Ctx, height: number, sample: Sample | undefined, style: SpeedStyle) {
  const u = height / 1080
  const r = 120 * u
  const cx = 60 * u + r
  const cy = height - 60 * u - r
  const speed = sample?.speed !== undefined ? sample.speed * MPS_TO[style.unit] : undefined
  const fraction = speed === undefined ? 0 : Math.min(Math.max(speed / style.max, 0), 1)

  ctx.save()

  // Backing disc
  ctx.beginPath()
  ctx.arc(cx, cy, r + 18 * u, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)'
  ctx.fill()

  // Track
  ctx.lineCap = 'round'
  ctx.lineWidth = 14 * u
  ctx.beginPath()
  ctx.arc(cx, cy, r, START, START + SWEEP)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.stroke()

  // Value
  if (fraction > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, START, START + SWEEP * fraction)
    ctx.strokeStyle = '#ffb020'
    ctx.stroke()
  }

  // Readout
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${84 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.fillText(speed === undefined ? '--' : Math.round(speed).toString(), cx, cy + 22 * u)
  ctx.font = `600 ${24 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.fillText(LABEL[style.unit], cx, cy + 62 * u)

  ctx.restore()
}
