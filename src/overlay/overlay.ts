import { readingAt, type Timeline } from '../telemetry/timeline'
import { hasChannel } from '../telemetry/types'
import type { Ctx, Units } from './common'
import { drawElevation } from './elevation'
import { drawInfo } from './info'
import { drawPedals, type PedalOptions } from './pedals'
import { drawRetroElevation, drawRetroInfo, drawRetroPedals, drawRetroRoute, drawRetroSpeed } from './retro'
import { drawRoute } from './route'
import { drawSpeed, type SpeedStyle } from './speed'

export interface Widgets {
  speed: boolean
  pedals: boolean
  elevation: boolean
  weather: boolean
  compass: boolean
  map: boolean
}

/** The overall look of every widget. */
export type OverlayTheme = 'standard' | 'retro'

export const THEMES: { key: OverlayTheme; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'retro', label: 'Retro HUD' },
]

export interface OverlayStyle {
  theme: OverlayTheme
  speed: SpeedStyle
  pedals: PedalOptions
  widgets: Widgets
}

/** Decides which pedal bars to show from the data that's available. */
export function defaultPedals(timeline: Timeline): PedalOptions {
  const measuredBrake = hasChannel(timeline.video, 'brake') || hasChannel(timeline.log, 'brake')
  return {
    throttle: hasChannel(timeline.log, 'throttle'),
    brake: measuredBrake || !!timeline.brakeEstimate,
    rpm: hasChannel(timeline.log, 'rpm'),
    brakeEstimated: !measuredBrake,
  }
}

/** Which widgets have data to show. */
export function availableWidgets(timeline: Timeline): Widgets {
  const p = defaultPedals(timeline)
  return {
    speed: true,
    pedals: p.throttle || p.brake || p.rpm,
    elevation: hasChannel(timeline.route, 'alt'),
    weather: !!timeline.weather,
    compass: hasChannel(timeline.route, 'heading'),
    map: !!timeline.route,
  }
}

/** Draws every enabled widget for video time t. Shared by the live preview and the export. */
export function drawOverlay(ctx: Ctx, width: number, height: number, timeline: Timeline, t: number, style: OverlayStyle) {
  const reading = readingAt(timeline, t)
  const units: Units = style.speed.unit === 'mph' ? 'imperial' : 'metric'
  const w = style.widgets
  if (style.theme === 'retro') {
    if (w.speed) drawRetroSpeed(ctx, height, reading, style.speed)
    if (w.pedals) drawRetroPedals(ctx, height, reading, style.pedals)
    if (w.compass || w.weather) drawRetroInfo(ctx, height, reading.heading, timeline.weather, units, { compass: w.compass, weather: w.weather })
    if (w.map && timeline.route) drawRetroRoute(ctx, width, height, timeline.route, t)
    if (w.elevation && timeline.route) drawRetroElevation(ctx, width, height, timeline.route, reading.alt, t, units)
    return
  }
  if (w.speed) drawSpeed(ctx, height, reading, style.speed)
  if (w.pedals) drawPedals(ctx, height, reading, style.pedals)
  if (w.compass || w.weather) drawInfo(ctx, height, reading.heading, timeline.weather, units, { compass: w.compass, weather: w.weather })
  if (w.map && timeline.route) drawRoute(ctx, width, height, timeline.route, t)
  if (w.elevation && timeline.route) drawElevation(ctx, width, height, timeline.route, reading.alt, t, units)
}
