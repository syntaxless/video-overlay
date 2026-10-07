import type { Sample } from '../telemetry/types'
import { ACCENT, FONT, PANEL, type Ctx } from './common'

export type { Ctx }

export type SpeedUnit = 'mph' | 'kmh'

/** How the speed widget looks. */
export type SpeedLook = 'arc' | 'dial' | 'digital'

export const SPEED_LOOKS: { key: SpeedLook; label: string }[] = [
  { key: 'arc', label: 'Ring' },
  { key: 'dial', label: 'Needle' },
  { key: 'digital', label: 'Digital' },
]

export interface SpeedStyle {
  unit: SpeedUnit
  /** Top of the dial, in the chosen unit. */
  max: number
  look: SpeedLook
}

const MPS_TO: Record<SpeedUnit, number> = { mph: 2.2369363, kmh: 3.6 }
const LABEL: Record<SpeedUnit, string> = { mph: 'MPH', kmh: 'KM/H' }

const BLUE = '#3b9cff'

const START = Math.PI * 0.75
const SWEEP = Math.PI * 1.5

// Every look sits in the same bottom-left box so it never runs into the pedal bars.
const MARGIN = 42
const BOX = 276

/**
 * Draws the speed widget in the bottom-left corner. Sizes are relative to the
 * frame height so it looks the same at 1080p and 4K.
 */
export function drawSpeed(ctx: Ctx, height: number, sample: Sample | undefined, style: SpeedStyle) {
  const u = height / 1080
  const speed = sample?.speed !== undefined ? sample.speed * MPS_TO[style.unit] : undefined
  const fraction = speed === undefined ? 0 : Math.min(Math.max(speed / style.max, 0), 1)
  const text = speed === undefined ? '--' : Math.round(speed).toString()

  ctx.save()
  if (style.look === 'dial') drawDial(ctx, u, height, text, fraction, style)
  else if (style.look === 'digital') drawDigital(ctx, u, height, text, fraction, style)
  else drawArc(ctx, u, height, text, fraction, style)
  ctx.restore()
}

/** A glowing ring that fills with speed, with the number in the middle. */
function drawArc(ctx: Ctx, u: number, height: number, text: string, fraction: number, style: SpeedStyle) {
  const r = 120 * u
  const cx = 60 * u + r
  const cy = height - 60 * u - r

  ctx.beginPath()
  ctx.arc(cx, cy, r + 18 * u, 0, Math.PI * 2)
  ctx.fillStyle = PANEL
  ctx.fill()

  ctx.lineCap = 'round'
  ctx.lineWidth = 14 * u
  ctx.beginPath()
  ctx.arc(cx, cy, r, START, START + SWEEP)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.stroke()

  if (fraction > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, START, START + SWEEP * fraction)
    ctx.strokeStyle = BLUE
    ctx.stroke()
  }

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${84 * u}px ${FONT}`
  ctx.fillText(text, cx, cy + 22 * u)
  ctx.font = `600 ${24 * u}px ${FONT}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.fillText(LABEL[style.unit], cx, cy + 62 * u)
}

/** A classic analogue speedometer with numbered ticks and a needle. */
function drawDial(ctx: Ctx, u: number, height: number, text: string, fraction: number, style: SpeedStyle) {
  const r = 128 * u
  const cx = (MARGIN + BOX / 2) * u
  const cy = height - (MARGIN + BOX / 2) * u
  const angle = (f: number) => START + SWEEP * f

  ctx.beginPath()
  ctx.arc(cx, cy, r + 10 * u, 0, Math.PI * 2)
  ctx.fillStyle = PANEL
  ctx.fill()
  ctx.lineWidth = 3 * u
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.stroke()

  // Ticks: a numbered one every `major`, a short one halfway between.
  const major = style.max <= 160 ? 20 : 40
  const minor = major / 2
  ctx.lineCap = 'butt'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${20 * u}px ${FONT}`
  for (let v = 0; v <= style.max + 1e-6; v += minor) {
    const a = angle(v / style.max)
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
    const outer = r - 6 * u
    const inner = outer - (isMajor ? 18 : 9) * u
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer)
    ctx.lineWidth = (isMajor ? 4 : 2) * u
    ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.55)'
    ctx.stroke()
    if (isMajor) {
      const lr = r - 42 * u
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.fillText(String(v), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr)
    }
  }

  // Small readout in the gap at the bottom of the dial.
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${40 * u}px ${FONT}`
  ctx.fillText(text, cx, cy + 82 * u)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.font = `600 ${16 * u}px ${FONT}`
  ctx.fillText(LABEL[style.unit], cx, cy + 104 * u)

  // Needle and hub.
  const a = angle(fraction)
  const tip = r - 14 * u
  const tail = 18 * u
  const half = 5 * u
  const nx = Math.cos(a)
  const ny = Math.sin(a)
  ctx.beginPath()
  ctx.moveTo(cx + nx * tip, cy + ny * tip)
  ctx.lineTo(cx - ny * half - nx * tail, cy + nx * half - ny * tail)
  ctx.lineTo(cx + ny * half - nx * tail, cy - nx * half - ny * tail)
  ctx.closePath()
  ctx.fillStyle = BLUE
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, 11 * u, 0, Math.PI * 2)
  ctx.fillStyle = '#1b1e24'
  ctx.fill()
  ctx.lineWidth = 3 * u
  ctx.strokeStyle = BLUE
  ctx.stroke()
}

/** A big number on a panel with a segmented bar underneath, like a dash display. */
function drawDigital(ctx: Ctx, u: number, height: number, text: string, fraction: number, style: SpeedStyle) {
  const w = BOX * u
  const h = 156 * u
  const x = MARGIN * u
  const y = height - MARGIN * u - h
  const pad = 22 * u

  ctx.fillStyle = PANEL
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 16 * u)
  ctx.fill()

  // Number right-aligned so the digits don't jump around as speed changes.
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${96 * u}px ${FONT}`
  const numRight = x + w - 92 * u
  ctx.fillText(text, numRight, y + 102 * u)
  ctx.textAlign = 'left'
  ctx.fillStyle = BLUE
  ctx.font = `700 ${24 * u}px ${FONT}`
  ctx.fillText(LABEL[style.unit], numRight + 12 * u, y + 102 * u)

  // Segment bar: green, then amber, then red near the top of the scale.
  const segments = 20
  const gap = 4 * u
  const barY = y + h - pad - 14 * u
  const segW = (w - pad * 2 - gap * (segments - 1)) / segments
  const lit = Math.round(fraction * segments)
  for (let i = 0; i < segments; i++) {
    const p = i / segments
    ctx.fillStyle = i < lit ? (p < 0.6 ? '#3ddc84' : p < 0.85 ? ACCENT : '#ff4d3d') : 'rgba(255, 255, 255, 0.14)'
    ctx.fillRect(x + pad + i * (segW + gap), barY, segW, 14 * u)
  }
}
