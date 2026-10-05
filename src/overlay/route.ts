import type { Telemetry } from '../telemetry/types'
import { ACCENT, decimate, indexAt, panel, type Ctx } from './common'

interface Projected {
  times: Float64Array
  /** Positions scaled to 0..1 inside the map box, y down. */
  xs: Float64Array
  ys: Float64Array
  /** Route width and height in those units; the longer side is 1. */
  w: number
  h: number
}

const cache = new WeakMap<Telemetry, Projected>()

/** Projects the route once (flat-earth is fine at road-trip scale) and caches it. */
function project(route: Telemetry): Projected | undefined {
  const hit = cache.get(route)
  if (hit) return hit
  const s = decimate(route.samples.filter((x) => x.lat !== undefined && x.lon !== undefined), 2000)
  if (s.length < 2) return undefined
  const lat0 = s.reduce((a, x) => a + x.lat!, 0) / s.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const px = s.map((x) => x.lon! * k)
  const py = s.map((x) => -x.lat!)
  const minX = Math.min(...px), maxX = Math.max(...px)
  const minY = Math.min(...py), maxY = Math.max(...py)
  const span = Math.max(maxX - minX, maxY - minY, 1e-6)
  const out: Projected = {
    times: Float64Array.from(s, (x) => x.t),
    xs: Float64Array.from(px, (x) => (x - minX) / span),
    ys: Float64Array.from(py, (y) => (y - minY) / span),
    w: (maxX - minX) / span,
    h: (maxY - minY) / span,
  }
  cache.set(route, out)
  return out
}

/** Draws the whole route in the top-right corner, the driven part highlighted, with a dot for now. */
export function drawRoute(ctx: Ctx, width: number, height: number, route: Telemetry, t: number) {
  const p = project(route)
  if (!p) return
  const u = height / 1080
  const max = 300 * u
  const pad = 24 * u
  // Fit the route's shape into a box no bigger than max × max (and not too thin).
  const boxW = Math.max(max * p.w, 120 * u)
  const boxH = Math.max(max * p.h, 120 * u)
  const x0 = width - 42 * u - boxW - pad * 2
  const y0 = 42 * u
  panel(ctx, x0, y0, boxW + pad * 2, boxH + pad * 2, 18 * u)
  const s = Math.min(boxW / Math.max(p.w, 1e-6), boxH / Math.max(p.h, 1e-6))
  const ox = x0 + pad + (boxW - p.w * s) / 2
  const oy = y0 + pad + (boxH - p.h * s) / 2
  const X = (i: number) => ox + p.xs[i] * s
  const Y = (i: number) => oy + p.ys[i] * s

  const now = indexAt(p.times, t)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = 6 * u
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.beginPath()
  for (let i = 0; i < p.xs.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(i))
  ctx.stroke()

  if (now >= 0) {
    ctx.strokeStyle = ACCENT
    ctx.beginPath()
    for (let i = 0; i <= now; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(i))
    // Interpolate the dot between samples so it glides rather than steps.
    let dx = X(now)
    let dy = Y(now)
    if (now < p.xs.length - 1) {
      const f = (t - p.times[now]) / (p.times[now + 1] - p.times[now])
      dx += (X(now + 1) - dx) * f
      dy += (Y(now + 1) - dy) * f
    }
    ctx.lineTo(dx, dy)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(dx, dy, 11 * u, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 4 * u
    ctx.strokeStyle = ACCENT
    ctx.stroke()
  }
  ctx.restore()
}
