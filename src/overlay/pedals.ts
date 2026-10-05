import type { Sample } from '../telemetry/types'
import type { Ctx } from './speed'

export interface PedalOptions {
  throttle: boolean
  brake: boolean
  rpm: boolean
  /** Shown under the brake bar when brake is estimated rather than measured. */
  brakeEstimated: boolean
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Draws RPM and throttle/brake bars to the right of the speedometer.
 * Uses the same 1080p-relative sizing as the speedometer.
 */
export function drawPedals(ctx: Ctx, height: number, sample: Sample | undefined, opts: PedalOptions) {
  const bars: { label: string; value: number | undefined; color: string; note?: string }[] = []
  if (opts.throttle) bars.push({ label: 'THR', value: sample?.throttle, color: '#3ddc84' })
  if (opts.brake) bars.push({ label: 'BRK', value: sample?.brake, color: '#ff4d4d', note: opts.brakeEstimated ? 'est.' : undefined })
  if (bars.length === 0 && !opts.rpm) return

  const u = height / 1080
  const barW = 34 * u
  const gap = 22 * u
  const pad = 22 * u
  const barH = 190 * u
  const rpmH = opts.rpm ? 56 * u : 0
  const width = Math.max(bars.length * barW + (bars.length - 1) * gap + pad * 2, opts.rpm ? 150 * u : 0)
  const panelH = barH + rpmH + 70 * u
  // Speedometer occupies x 42..318 at 1080p; sit next to it, bottom-aligned.
  const x = 340 * u
  const y = height - 42 * u - panelH

  ctx.save()
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)'
  roundRect(ctx, x, y, width, panelH, 18 * u)
  ctx.fill()

  ctx.textAlign = 'center'
  if (opts.rpm) {
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${38 * u}px ${FONT}`
    ctx.fillText(sample?.rpm !== undefined ? Math.round(sample.rpm).toLocaleString('en-US') : '--', x + width / 2, y + 48 * u)
    ctx.font = `600 ${18 * u}px ${FONT}`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
    ctx.fillText('RPM', x + width / 2, y + 70 * u)
  }

  const barsW = bars.length * barW + (bars.length - 1) * gap
  let bx = x + (width - barsW) / 2
  const by = y + rpmH + 22 * u
  for (const bar of bars) {
    const f = bar.value === undefined ? 0 : Math.min(Math.max(bar.value / 100, 0), 1)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
    roundRect(ctx, bx, by, barW, barH, 8 * u)
    ctx.fill()
    if (f > 0) {
      ctx.fillStyle = bar.color
      ctx.save()
      roundRect(ctx, bx, by, barW, barH, 8 * u)
      ctx.clip()
      ctx.fillRect(bx, by + barH * (1 - f), barW, barH * f)
      ctx.restore()
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.font = `600 ${18 * u}px ${FONT}`
    ctx.fillText(bar.label, bx + barW / 2, by + barH + 26 * u)
    if (bar.note) {
      ctx.font = `500 ${14 * u}px ${FONT}`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.fillText(bar.note, bx + barW / 2, by + barH + 44 * u)
    }
    bx += barW + gap
  }
  ctx.restore()
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
