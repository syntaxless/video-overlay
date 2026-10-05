export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
export const PANEL = 'rgba(10, 12, 16, 0.55)'
export const ACCENT = '#ffb020'

export type Units = 'imperial' | 'metric'

export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.fillStyle = PANEL
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

/** Finds the last index with samples[i].t <= t. */
export function indexAt(times: Float64Array, t: number): number {
  let lo = 0
  let hi = times.length - 1
  if (hi < 0 || t < times[0]) return -1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  return times[hi] <= t ? hi : lo
}

/** Keeps at most `max` evenly spaced items, always including the last. */
export function decimate<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const step = (items.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)])
}
