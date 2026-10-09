// "Retro HUD" theme: every widget redrawn as an 80s sci-fi heads-up display,
// with neon outlines, scanlines, segmented gauges and a heading tape.
// Widgets keep the same corners and sizes as the standard theme.

import { describeWeather, type Weather } from '../telemetry/openmeteo'
import type { Sample, Telemetry } from '../telemetry/types'
import { indexAt, type Ctx, type Units } from './common'
import { M_TO_FT, profile } from './elevation'
import { compassPoint } from './info'
import type { PedalOptions } from './pedals'
import { project } from './route'
import type { SpeedStyle } from './speed'

const DISPLAY = 'Orbitron, "Share Tech Mono", ui-monospace, monospace'
const MONO = '"Share Tech Mono", ui-monospace, Menlo, Consolas, monospace'

const CYAN = '#2ef2ff'
const MAGENTA = '#ff3df2'
const AMBER = '#ffc53d'
const GREEN = '#3dff9a'
const RED = '#ff3d5a'
const DIM = 'rgba(46, 242, 255, 0.16)'
const PANEL = 'rgba(8, 4, 24, 0.62)'

/** Fonts the theme draws with. Canvas only uses a web font once it has loaded. */
export function loadRetroFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  return Promise.all(['700 16px Orbitron', '900 16px Orbitron', '400 16px "Share Tech Mono"'].map((f) => document.fonts.load(f)))
}

function glow(ctx: Ctx, color: string, blur: number) {
  ctx.shadowColor = color
  ctx.shadowBlur = blur
}

function noGlow(ctx: Ctx) {
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

/** A box with its top-left and bottom-right corners cut off. */
function chamfer(ctx: Ctx, x: number, y: number, w: number, h: number, c: number) {
  ctx.beginPath()
  ctx.moveTo(x + c, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + h - c)
  ctx.lineTo(x + w - c, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + c)
  ctx.closePath()
}

/**
 * Dark glass panel with scanlines, a neon edge and a label tab hanging off
 * its top edge.
 */
function hudPanel(ctx: Ctx, u: number, x: number, y: number, w: number, h: number, label?: string) {
  const c = 16 * u
  ctx.save()
  chamfer(ctx, x, y, w, h, c)
  ctx.fillStyle = PANEL
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = 'rgba(46, 242, 255, 0.06)'
  for (let yy = y; yy < y + h; yy += 4 * u) ctx.fillRect(x, yy, w, 1.5 * u)
  ctx.restore()

  glow(ctx, CYAN, 10 * u)
  ctx.strokeStyle = 'rgba(46, 242, 255, 0.75)'
  ctx.lineWidth = 2 * u
  chamfer(ctx, x, y, w, h, c)
  ctx.stroke()

  // Bright corner brackets on the two square corners.
  const k = 14 * u
  ctx.strokeStyle = CYAN
  ctx.lineWidth = 4 * u
  ctx.beginPath()
  ctx.moveTo(x + w - k, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + k)
  ctx.moveTo(x, y + h - k)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x + k, y + h)
  ctx.stroke()
  noGlow(ctx)

  if (label) {
    ctx.font = `400 ${14 * u}px ${MONO}`
    const tw = ctx.measureText(label).width
    const th = 18 * u
    const tx = x + c
    const ty = y - th
    ctx.beginPath()
    ctx.moveTo(tx, ty + th)
    ctx.lineTo(tx + th * 0.6, ty)
    ctx.lineTo(tx + tw + 24 * u, ty)
    ctx.lineTo(tx + tw + 24 * u + th * 0.6, ty + th)
    ctx.closePath()
    ctx.fillStyle = CYAN
    ctx.fill()
    ctx.fillStyle = '#08041a'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, tx + 12 * u + th * 0.3, ty + th / 2 + u)
  }
  ctx.restore()
}

/** Mixes two #rrggbb colours. */
function mix(a: string, b: string, f: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16)
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * f)
  return `rgb(${ch(1)}, ${ch(3)}, ${ch(5)})`
}

/** Side of the square speed panel at 1080p. The pedal panel matches its height. */
const SPEED_BOX = 276

const MPS_TO = { mph: 2.2369363, kmh: 3.6 }
const UNIT_LABEL = { mph: 'MPH', kmh: 'KM/H' }

/** Speed as a ring of neon segments with a sunset-gradient number, bottom-left. */
export function drawRetroSpeed(ctx: Ctx, height: number, sample: Sample | undefined, style: SpeedStyle) {
  const u = height / 1080
  const size = SPEED_BOX * u
  const x = 42 * u
  const y = height - 42 * u - size
  const speed = sample?.speed !== undefined ? sample.speed * MPS_TO[style.unit] : undefined
  const fraction = speed === undefined ? 0 : Math.min(Math.max(speed / style.max, 0), 1)
  const text = speed === undefined ? '--' : Math.round(speed).toString()

  ctx.save()
  hudPanel(ctx, u, x, y, size, size, 'VELOCITY')
  const cx = x + size / 2
  const cy = y + size / 2 + 4 * u
  const start = Math.PI * 0.75
  const sweep = Math.PI * 1.5

  // Fine scale ring outside the segments.
  const ro = 116 * u
  ctx.lineCap = 'butt'
  for (let v = 0; v <= style.max + 1e-6; v += 10) {
    const a = start + sweep * (v / style.max)
    const major = v % 20 === 0
    const r0 = ro - (major ? 8 : 4) * u
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro)
    ctx.strokeStyle = major ? 'rgba(46, 242, 255, 0.8)' : 'rgba(46, 242, 255, 0.4)'
    ctx.lineWidth = (major ? 2.5 : 1.5) * u
    ctx.stroke()
  }

  // Segments: cyan at low speed shading to magenta, red at the top of the scale.
  const segments = 28
  const r1 = 102 * u
  const r2 = 80 * u
  const gap = 0.02
  const lit = Math.round(fraction * segments)
  for (let i = 0; i < segments; i++) {
    const a0 = start + (sweep * i) / segments + gap
    const a1 = start + (sweep * (i + 1)) / segments - gap
    ctx.beginPath()
    ctx.arc(cx, cy, r1, a0, a1)
    ctx.arc(cx, cy, r2, a1, a0, true)
    ctx.closePath()
    const p = i / (segments - 1)
    if (i < lit) {
      const color = p < 0.85 ? mix(CYAN, MAGENTA, p / 0.85) : RED
      ctx.fillStyle = color
      glow(ctx, color, 12 * u)
      ctx.fill()
      noGlow(ctx)
    } else {
      ctx.fillStyle = DIM
      ctx.fill()
    }
  }

  // Number with an 80s chrome-sunset fill.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `900 ${70 * u}px ${DISPLAY}`
  const grad = ctx.createLinearGradient(0, cy - 40 * u, 0, cy + 24 * u)
  grad.addColorStop(0, '#fff6c2')
  grad.addColorStop(0.45, AMBER)
  grad.addColorStop(1, MAGENTA)
  glow(ctx, MAGENTA, 18 * u)
  ctx.fillStyle = grad
  ctx.fillText(text, cx, cy + 24 * u)
  noGlow(ctx)

  ctx.font = `400 ${22 * u}px ${MONO}`
  ctx.fillStyle = CYAN
  glow(ctx, CYAN, 8 * u)
  ctx.fillText(UNIT_LABEL[style.unit], cx, cy + 100 * u)
  noGlow(ctx)
  ctx.restore()
}

/** RPM readout and throttle/brake as stacked LED ladders, next to the speed widget. */
export function drawRetroPedals(ctx: Ctx, height: number, sample: Sample | undefined, opts: PedalOptions) {
  const bars: { label: string; value: number | undefined; color: string; note?: string }[] = []
  if (opts.throttle) bars.push({ label: 'THR', value: sample?.throttle, color: GREEN })
  if (opts.brake) bars.push({ label: 'BRK', value: sample?.brake, color: RED, note: opts.brakeEstimated ? 'EST' : undefined })
  if (bars.length === 0 && !opts.rpm) return

  const u = height / 1080
  const barW = 34 * u
  const gap = 22 * u
  const pad = 22 * u
  const rpmH = opts.rpm ? 56 * u : 0
  // Same height as the speed panel so the two sit flush as one block.
  const panelH = SPEED_BOX * u
  const barH = panelH - rpmH - 70 * u
  const width = Math.max(bars.length * barW + (bars.length - 1) * gap + pad * 2, opts.rpm ? 160 * u : 0)
  const x = 340 * u
  const y = height - 42 * u - panelH

  ctx.save()
  hudPanel(ctx, u, x, y, width, panelH, 'DRIVE')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (opts.rpm) {
    ctx.font = `700 ${32 * u}px ${DISPLAY}`
    ctx.fillStyle = '#ffffff'
    glow(ctx, CYAN, 12 * u)
    ctx.fillText(sample?.rpm !== undefined ? Math.round(sample.rpm).toString() : '----', x + width / 2, y + 48 * u)
    noGlow(ctx)
    ctx.font = `400 ${16 * u}px ${MONO}`
    ctx.fillStyle = CYAN
    ctx.fillText('RPM', x + width / 2, y + 68 * u)
  }

  const segments = 12
  const segGap = 4 * u
  const segH = (barH - segGap * (segments - 1)) / segments
  const barsW = bars.length * barW + (bars.length - 1) * gap
  let bx = x + (width - barsW) / 2
  const by = y + rpmH + 22 * u
  for (const bar of bars) {
    const f = bar.value === undefined ? 0 : Math.min(Math.max(bar.value / 100, 0), 1)
    const lit = Math.round(f * segments)
    for (let i = 0; i < segments; i++) {
      const sy = by + barH - (i + 1) * segH - i * segGap
      if (i < lit) {
        ctx.fillStyle = bar.color
        glow(ctx, bar.color, 10 * u)
        ctx.fillRect(bx, sy, barW, segH)
        noGlow(ctx)
      } else {
        ctx.fillStyle = DIM
        ctx.fillRect(bx, sy, barW, segH)
      }
    }
    ctx.fillStyle = bar.color
    ctx.font = `400 ${18 * u}px ${MONO}`
    ctx.fillText(bar.label, bx + barW / 2, by + barH + 26 * u)
    if (bar.note) {
      ctx.font = `400 ${13 * u}px ${MONO}`
      ctx.fillStyle = 'rgba(46, 242, 255, 0.6)'
      ctx.fillText(bar.note, bx + barW / 2, by + barH + 43 * u)
    }
    bx += barW + gap
  }
  ctx.restore()
}

/** Heading tape like a fighter HUD, and a weather readout, along the top-left edge. */
export function drawRetroInfo(
  ctx: Ctx,
  height: number,
  heading: number | undefined,
  weather: Weather | undefined,
  units: Units,
  opts: { compass: boolean; weather: boolean },
) {
  const u = height / 1080
  let x = 42 * u
  const y = 42 * u
  const h = 84 * u
  ctx.save()

  if (opts.compass) {
    const w = 340 * u
    hudPanel(ctx, u, x, y, w, h, 'HEADING')
    const cx = x + w / 2
    if (heading !== undefined) {
      // Show 50° either side of the heading, fading towards the edges.
      const span = 50
      const pxPerDeg = (w / 2 - 22 * u) / span
      ctx.save()
      chamfer(ctx, x, y, w, h, 16 * u)
      ctx.clip()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.font = `400 ${16 * u}px ${MONO}`
      const first = Math.ceil((heading - span) / 5) * 5
      for (let d = first; d <= heading + span; d += 5) {
        const off = d - heading
        const tx = cx + off * pxPerDeg
        ctx.globalAlpha = Math.max(0, 1 - (Math.abs(off) / span) ** 2)
        const major = d % 30 === 0
        const mid = !major && d % 15 === 0
        ctx.strokeStyle = CYAN
        ctx.lineWidth = (major ? 2.5 : 1.5) * u
        ctx.beginPath()
        ctx.moveTo(tx, y + 12 * u)
        ctx.lineTo(tx, y + 12 * u + (major ? 14 : mid ? 9 : 5) * u)
        ctx.stroke()
        if (major) {
          const n = ((d % 360) + 360) % 360
          const cardinal = ['N', 'E', 'S', 'W'][n / 90]
          ctx.fillStyle = cardinal ? AMBER : CYAN
          ctx.fillText(n % 90 === 0 ? cardinal : String(n).padStart(3, '0'), tx, y + 46 * u)
        }
      }
      ctx.restore()
    }

    // Caret at the top and a boxed readout under the centre of the tape.
    ctx.fillStyle = MAGENTA
    glow(ctx, MAGENTA, 8 * u)
    ctx.beginPath()
    ctx.moveTo(cx - 7 * u, y + 4 * u)
    ctx.lineTo(cx + 7 * u, y + 4 * u)
    ctx.lineTo(cx, y + 14 * u)
    ctx.closePath()
    ctx.fill()
    const value = heading === undefined ? '---' : `${String(Math.round(((heading % 360) + 360) % 360) % 360).padStart(3, '0')} ${compassPoint(heading)}`
    ctx.font = `700 ${20 * u}px ${DISPLAY}`
    const bw = ctx.measureText(value).width + 24 * u
    const bh = 28 * u
    const bxl = cx - bw / 2
    const byt = y + h - bh - 6 * u
    ctx.fillStyle = 'rgba(8, 4, 24, 0.9)'
    ctx.fillRect(bxl, byt, bw, bh)
    ctx.strokeStyle = MAGENTA
    ctx.lineWidth = 2 * u
    ctx.strokeRect(bxl, byt, bw, bh)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(value, cx, byt + bh / 2 + u)
    noGlow(ctx)
    x += w + 20 * u
  }

  if (opts.weather && weather) {
    const temp = units === 'imperial' ? weather.temperature * 1.8 + 32 : weather.temperature
    const wind = units === 'imperial' ? weather.windSpeed / 1.609344 : weather.windSpeed
    const main = `${Math.round(temp)}°${units === 'imperial' ? 'F' : 'C'}`
    const line1 = describeWeather(weather.code).toUpperCase()
    const line2 = `WIND ${Math.round(wind)} ${units === 'imperial' ? 'MPH' : 'KM/H'} ${compassPoint(weather.windDirection)}`
    ctx.font = `700 ${34 * u}px ${DISPLAY}`
    const mainW = ctx.measureText(main).width
    ctx.font = `400 ${20 * u}px ${MONO}`
    const detailW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width)
    const w = 24 * u + mainW + 22 * u + detailW + 26 * u
    hudPanel(ctx, u, x, y, w, h, 'ATMOS')
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${34 * u}px ${DISPLAY}`
    ctx.fillStyle = '#ffffff'
    glow(ctx, CYAN, 12 * u)
    ctx.fillText(main, x + 24 * u, y + h / 2 + 2 * u)
    noGlow(ctx)
    const dx = x + 24 * u + mainW + 22 * u
    ctx.strokeStyle = 'rgba(46, 242, 255, 0.5)'
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.moveTo(dx - 11 * u, y + 18 * u)
    ctx.lineTo(dx - 11 * u, y + h - 18 * u)
    ctx.stroke()
    ctx.font = `400 ${20 * u}px ${MONO}`
    ctx.fillStyle = CYAN
    ctx.fillText(line1, dx, y + h / 2 - 12 * u)
    ctx.fillStyle = 'rgba(46, 242, 255, 0.7)'
    ctx.fillText(line2, dx, y + h / 2 + 14 * u)
  }
  ctx.restore()
}

/** The route on a radar grid, with a pulsing target reticle for the car, top-right. */
export function drawRetroRoute(ctx: Ctx, width: number, height: number, route: Telemetry, t: number) {
  const p = project(route)
  if (!p) return
  const u = height / 1080
  const max = 300 * u
  const pad = 24 * u
  const boxW = Math.max(max * p.w, 120 * u)
  const boxH = Math.max(max * p.h, 120 * u)
  const x0 = width - 42 * u - boxW - pad * 2
  const y0 = 42 * u
  const pw = boxW + pad * 2
  const ph = boxH + pad * 2
  ctx.save()
  hudPanel(ctx, u, x0, y0, pw, ph, 'NAV')

  ctx.save()
  chamfer(ctx, x0, y0, pw, ph, 16 * u)
  ctx.clip()
  ctx.strokeStyle = 'rgba(46, 242, 255, 0.12)'
  ctx.lineWidth = u
  const cell = 30 * u
  ctx.beginPath()
  for (let gx = x0 + cell; gx < x0 + pw; gx += cell) {
    ctx.moveTo(gx, y0)
    ctx.lineTo(gx, y0 + ph)
  }
  for (let gy = y0 + cell; gy < y0 + ph; gy += cell) {
    ctx.moveTo(x0, gy)
    ctx.lineTo(x0 + pw, gy)
  }
  ctx.stroke()
  ctx.restore()

  const s = Math.min(boxW / Math.max(p.w, 1e-6), boxH / Math.max(p.h, 1e-6))
  const ox = x0 + pad + (boxW - p.w * s) / 2
  const oy = y0 + pad + (boxH - p.h * s) / 2
  const X = (i: number) => ox + p.xs[i] * s
  const Y = (i: number) => oy + p.ys[i] * s

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = 3 * u
  ctx.strokeStyle = 'rgba(46, 242, 255, 0.45)'
  ctx.beginPath()
  for (let i = 0; i < p.xs.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(i))
  ctx.stroke()

  const now = indexAt(p.times, t)
  if (now >= 0) {
    let dx = X(now)
    let dy = Y(now)
    if (now < p.xs.length - 1) {
      const f = (t - p.times[now]) / (p.times[now + 1] - p.times[now])
      dx += (X(now + 1) - dx) * f
      dy += (Y(now + 1) - dy) * f
    }
    ctx.strokeStyle = MAGENTA
    ctx.lineWidth = 4 * u
    glow(ctx, MAGENTA, 12 * u)
    ctx.beginPath()
    for (let i = 0; i <= now; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(i))
    ctx.lineTo(dx, dy)
    ctx.stroke()

    // Reticle: a ring that breathes once a second, with crosshair ticks.
    const r = (12 + 3 * Math.sin(t * Math.PI * 2)) * u
    ctx.strokeStyle = AMBER
    glow(ctx, AMBER, 10 * u)
    ctx.lineWidth = 2.5 * u
    ctx.beginPath()
    ctx.arc(dx, dy, r, 0, Math.PI * 2)
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(dx + ax * (r + 3 * u), dy + ay * (r + 3 * u))
      ctx.lineTo(dx + ax * (r + 11 * u), dy + ay * (r + 11 * u))
    }
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(dx, dy, 3.5 * u, 0, Math.PI * 2)
    ctx.fill()
    noGlow(ctx)
  }
  ctx.restore()
}

/** Altitude readout over a wireframe-hatched elevation profile, bottom-right. */
export function drawRetroElevation(ctx: Ctx, width: number, height: number, route: Telemetry, alt: number | undefined, t: number, units: Units) {
  const p = profile(route)
  if (!p) return
  const u = height / 1080
  const w = 380 * u
  const h = 150 * u
  const x0 = width - 42 * u - w
  const y0 = height - 42 * u - h
  ctx.save()
  hudPanel(ctx, u, x0, y0, w, h, 'ALTITUDE')

  const pad = 20 * u
  const value = alt === undefined ? '----' : Math.round(units === 'imperial' ? alt * M_TO_FT : alt).toString()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${36 * u}px ${DISPLAY}`
  ctx.fillStyle = '#ffffff'
  glow(ctx, CYAN, 12 * u)
  ctx.fillText(value, x0 + pad, y0 + 52 * u)
  noGlow(ctx)
  const valueW = ctx.measureText(value).width
  ctx.font = `400 ${20 * u}px ${MONO}`
  ctx.fillStyle = CYAN
  ctx.fillText(units === 'imperial' ? 'FT' : 'M', x0 + pad + valueW + 10 * u, y0 + 52 * u)

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
  const nowX = X(Math.min(Math.max(t, t0), t1))
  const started = alt !== undefined && indexAt(p.times, t) >= 0

  // Wireframe terrain: vertical hatching clipped to the profile, driven part in magenta.
  const area = () => {
    ctx.beginPath()
    ctx.moveTo(gx, gy + gh)
    for (let i = 0; i < p.alts.length; i++) ctx.lineTo(X(p.times[i]), Y(p.alts[i]))
    ctx.lineTo(gx + gw, gy + gh)
    ctx.closePath()
  }
  ctx.save()
  area()
  ctx.clip()
  ctx.lineWidth = 1.5 * u
  for (let hx = gx; hx <= gx + gw; hx += 6 * u) {
    ctx.strokeStyle = started && hx <= nowX ? 'rgba(255, 61, 242, 0.55)' : 'rgba(46, 242, 255, 0.35)'
    ctx.beginPath()
    ctx.moveTo(hx, gy)
    ctx.lineTo(hx, gy + gh)
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = CYAN
  ctx.lineWidth = 2 * u
  ctx.lineJoin = 'round'
  glow(ctx, CYAN, 8 * u)
  ctx.beginPath()
  for (let i = 0; i < p.alts.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.times[i]), Y(p.alts[i]))
  ctx.stroke()
  noGlow(ctx)
  ctx.strokeStyle = 'rgba(46, 242, 255, 0.5)'
  ctx.beginPath()
  ctx.moveTo(gx, gy + gh)
  ctx.lineTo(gx + gw, gy + gh)
  ctx.stroke()

  if (started) {
    const my = Y(alt!)
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 2 * u
    ctx.setLineDash([4 * u, 4 * u])
    ctx.beginPath()
    ctx.moveTo(nowX, gy)
    ctx.lineTo(nowX, gy + gh)
    ctx.stroke()
    ctx.setLineDash([])
    const d = 7 * u
    ctx.fillStyle = AMBER
    glow(ctx, AMBER, 10 * u)
    ctx.beginPath()
    ctx.moveTo(nowX, my - d)
    ctx.lineTo(nowX + d, my)
    ctx.lineTo(nowX, my + d)
    ctx.lineTo(nowX - d, my)
    ctx.closePath()
    ctx.fill()
    noGlow(ctx)
  }
  ctx.restore()
}
