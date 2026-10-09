import type { Telemetry } from '../telemetry/types'
import { ACCENT, FONT, decimate, indexAt, panel, type Ctx, type Units } from './common'

export interface Profile {
  times: Float64Array
  alts: Float64Array
  min: number
  max: number
}

const cache = new WeakMap<Telemetry, Profile>()

export function profile(route: Telemetry): Profile | undefined {
  const hit = cache.get(route)
  if (hit) return hit
  const s = decimate(route.samples.filter((x) => x.alt !== undefined), 600)
  if (s.length < 2) return undefined
  const alts = Float64Array.from(s, (x) => x.alt!)
  const out = { times: Float64Array.from(s, (x) => x.t), alts, min: Math.min(...alts), max: Math.max(...alts) }
  cache.set(route, out)
  return out
}

export const M_TO_FT = 3.28084

/** Draws current elevation and the drive's elevation profile in the bottom-right corner. */
export function drawElevation(ctx: Ctx, width: number, height: number, route: Telemetry, alt: number | undefined, t: number, units: Units) {
  const p = profile(route)
  if (!p) return
  const u = height / 1080
  const w = 380 * u
  const h = 150 * u
  const x0 = width - 42 * u - w
  const y0 = height - 42 * u - h
  panel(ctx, x0, y0, w, h, 18 * u)

  const pad = 20 * u
  const value = alt === undefined ? '--' : Math.round(units === 'imperial' ? alt * M_TO_FT : alt).toLocaleString('en-US')
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.font = `700 ${40 * u}px ${FONT}`
  ctx.fillText(value, x0 + pad, y0 + 52 * u)
  const valueW = ctx.measureText(value).width
  ctx.font = `600 ${20 * u}px ${FONT}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.fillText(units === 'imperial' ? 'FT' : 'M', x0 + pad + valueW + 8 * u, y0 + 52 * u)
  ctx.textAlign = 'right'
  ctx.fillText('ELEVATION', x0 + w - pad, y0 + 50 * u)

  // Profile: a filled area across the panel, at least 30 m tall so flat roads stay flat.
  const gx = x0 + pad
  const gw = w - pad * 2
  const gy = y0 + 68 * u
  const gh = h - 68 * u - pad
  const range = Math.max(p.max - p.min, 30)
  const mid = (p.max + p.min) / 2
  const t0 = p.times[0]
  const t1 = p.times[p.times.length - 1]
  const X = (time: number) => gx + ((time - t0) / Math.max(t1 - t0, 1e-6)) * gw
  const Y = (a: number) => gy + gh / 2 - ((a - mid) / range) * gh
  ctx.beginPath()
  ctx.moveTo(X(p.times[0]), gy + gh)
  for (let i = 0; i < p.alts.length; i++) ctx.lineTo(X(p.times[i]), Y(p.alts[i]))
  ctx.lineTo(X(t1), gy + gh)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.fill()

  if (alt !== undefined && indexAt(p.times, t) >= 0) {
    const cx = X(Math.min(Math.max(t, t0), t1))
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.lineWidth = 2 * u
    ctx.beginPath()
    ctx.moveTo(cx, gy)
    ctx.lineTo(cx, gy + gh)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, Y(alt), 7 * u, 0, Math.PI * 2)
    ctx.fillStyle = ACCENT
    ctx.fill()
  }
  ctx.restore()
}
