import { readingAt, type Timeline } from '../telemetry/timeline'
import { hasChannel } from '../telemetry/types'
import { drawPedals, type PedalOptions } from './pedals'
import { drawSpeed, type Ctx, type SpeedStyle } from './speed'

export interface OverlayStyle {
  speed: SpeedStyle
  pedals: PedalOptions
}

/** Decides which widgets to show from the data that's available. */
export function defaultPedals(timeline: Timeline): PedalOptions {
  const measuredBrake = hasChannel(timeline.video, 'brake') || hasChannel(timeline.log, 'brake')
  return {
    throttle: hasChannel(timeline.log, 'throttle'),
    brake: measuredBrake || !!timeline.brakeEstimate,
    rpm: hasChannel(timeline.log, 'rpm'),
    brakeEstimated: !measuredBrake,
  }
}

/** Draws every widget for video time t. Shared by the live preview and the export. */
export function drawOverlay(ctx: Ctx, height: number, timeline: Timeline, t: number, style: OverlayStyle) {
  const reading = readingAt(timeline, t)
  drawSpeed(ctx, height, reading, style.speed)
  drawPedals(ctx, height, reading, style.pedals)
}
