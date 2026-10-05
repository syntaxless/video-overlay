import { describeWeather, type Weather } from '../telemetry/openmeteo'
import { FONT, panel, type Ctx, type Units } from './common'

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function compassPoint(degrees: number): string {
  const d = ((degrees % 360) + 360) % 360
  return POINTS[Math.round(d / 45) % 8]
}

export interface InfoOptions {
  compass: boolean
  weather: boolean
}

/** Draws the compass badge and weather chip along the top-left edge. */
export function drawInfo(ctx: Ctx, height: number, heading: number | undefined, weather: Weather | undefined, units: Units, opts: InfoOptions) {
  const u = height / 1080
  let x = 42 * u
  const y = 42 * u
  const h = 76 * u
  ctx.save()

  if (opts.compass) {
    const w = 150 * u
    panel(ctx, x, y, w, h, 18 * u)
    const cx = x + 40 * u
    const cy = y + h / 2
    // Ring with an arrow pointing the way the car is heading (north up).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 3 * u
    ctx.beginPath()
    ctx.arc(cx, cy, 24 * u, 0, Math.PI * 2)
    ctx.stroke()
    if (heading !== undefined) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate((heading * Math.PI) / 180)
      ctx.beginPath()
      ctx.moveTo(0, -20 * u)
      ctx.lineTo(11 * u, 12 * u)
      ctx.lineTo(0, 6 * u)
      ctx.lineTo(-11 * u, 12 * u)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${34 * u}px ${FONT}`
    ctx.fillText(heading === undefined ? '--' : compassPoint(heading), x + 76 * u, cy + 2 * u)
    x += w + 16 * u
  }

  if (opts.weather && weather) {
    const temp = units === 'imperial' ? weather.temperature * 1.8 + 32 : weather.temperature
    const wind = units === 'imperial' ? weather.windSpeed / 1.609344 : weather.windSpeed
    const main = `${Math.round(temp)}°${units === 'imperial' ? 'F' : 'C'}`
    const detail = `${describeWeather(weather.code)} · Wind ${Math.round(wind)} ${units === 'imperial' ? 'mph' : 'km/h'} ${compassPoint(weather.windDirection)}`
    ctx.font = `700 ${34 * u}px ${FONT}`
    const mainW = ctx.measureText(main).width
    ctx.font = `500 ${22 * u}px ${FONT}`
    const detailW = ctx.measureText(detail).width
    const w = 24 * u + mainW + 16 * u + detailW + 24 * u
    panel(ctx, x, y, w, h, 18 * u)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${34 * u}px ${FONT}`
    ctx.fillText(main, x + 24 * u, y + h / 2 + 2 * u)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.font = `500 ${22 * u}px ${FONT}`
    ctx.fillText(detail, x + 24 * u + mainW + 16 * u, y + h / 2 + 2 * u)
  }
  ctx.restore()
}
