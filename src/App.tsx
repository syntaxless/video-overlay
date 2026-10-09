import { useEffect, useMemo, useRef, useState } from 'react'
import { readGoProTelemetry } from './telemetry/gopro'
import { toTelemetry, type Mapping } from './telemetry/csv'
import { readLog, type LoadedLog } from './telemetry/log'
import { findOffset, type SyncResult } from './telemetry/sync'
import { buildTimeline, type Extras } from './telemetry/timeline'
import { fetchAltitudeOffset, fetchWeather } from './telemetry/openmeteo'
import type { Channel, Telemetry } from './telemetry/types'
import { availableWidgets, defaultPedals, drawOverlay, THEMES, type OverlayStyle, type OverlayTheme, type Widgets } from './overlay/overlay'
import { loadRetroFonts } from './overlay/retro'
import { SPEED_LOOKS, type SpeedLook, type SpeedUnit } from './overlay/speed'

const MAX_SPEED: Record<SpeedUnit, number> = { mph: 140, kmh: 220 }

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; what: string }
  | { kind: 'ready' }
  | { kind: 'exporting'; progress: number }
  | { kind: 'error'; message: string }

const MAPPED: { key: 'time' | Channel; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'speed', label: 'Speed' },
  { key: 'rpm', label: 'RPM' },
  { key: 'throttle', label: 'Throttle' },
  { key: 'brake', label: 'Brake' },
]

const WIDGET_LABELS: { key: keyof Widgets; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'pedals', label: 'RPM, throttle & brake' },
  { key: 'map', label: 'Route map' },
  { key: 'elevation', label: 'Elevation' },
  { key: 'compass', label: 'Compass' },
  { key: 'weather', label: 'Weather' },
]

const hasGps = (t?: Telemetry) => !!t?.samples.some((s) => s.lat !== undefined && s.lon !== undefined)

/** A match below this correlation is probably wrong; we say so instead of trusting it. */
const GOOD_SYNC = 0.8

export default function App() {
  const [file, setFile] = useState<File>()
  const [url, setUrl] = useState<string>()
  const [gopro, setGopro] = useState<Telemetry>()
  const [log, setLog] = useState<LoadedLog>()
  const [offset, setOffset] = useState(0)
  const [sync, setSync] = useState<SyncResult & { method: 'speed' | 'clock' }>()
  const [unit, setUnit] = useState<SpeedUnit>('mph')
  const [look, setLook] = useState<SpeedLook>('arc')
  const [theme, setTheme] = useState<OverlayTheme>('standard')
  const [retroFonts, setRetroFonts] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [fetched, setFetched] = useState<{ source: Telemetry; extras: Extras }>()
  const [hidden, setHidden] = useState<Set<keyof Widgets>>(new Set())
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController>(undefined)

  // Weather and terrain height for the route, looked up once per GPS source.
  const gpsSource = hasGps(gopro) ? gopro : hasGps(log?.telemetry) ? log!.telemetry : undefined
  const extras = useMemo(() => (fetched && fetched.source === gpsSource ? fetched.extras : {}), [fetched, gpsSource])
  useEffect(() => {
    if (!gpsSource) return
    let cancelled = false
    Promise.all([
      fetchWeather(gpsSource).catch(() => undefined),
      fetchAltitudeOffset(gpsSource).catch(() => undefined),
    ]).then(([weather, altitudeOffset]) => {
      if (!cancelled) setFetched({ source: gpsSource, extras: { weather, altitudeOffset } })
    })
    return () => {
      cancelled = true
    }
  }, [gpsSource])

  const timeline = useMemo(() => buildTimeline(gopro, log?.telemetry, offset, extras), [gopro, log, offset, extras])
  const available = useMemo(() => availableWidgets(timeline), [timeline])
  const style: OverlayStyle = useMemo(() => {
    const widgets = { ...available }
    for (const k of hidden) widgets[k] = false
    // Retro HUD waits for its fonts so neither the preview nor the export draws with fallbacks.
    const shown = theme === 'retro' && !retroFonts ? 'standard' : theme
    return { theme: shown, speed: { unit, max: MAX_SPEED[unit], look }, pedals: defaultPedals(timeline), widgets }
  }, [unit, look, theme, retroFonts, timeline, available, hidden])

  useEffect(() => {
    if (theme !== 'retro' || retroFonts) return
    const done = () => setRetroFonts(true)
    loadRetroFonts().then(done, done)
  }, [theme, retroFonts])


  /**
   * Lines the log up with the video by matching speed. When that fails or is
   * weak, falls back to the two clocks if both files carry real times.
   */
  function autoSync(video: Telemetry | undefined, logTelemetry: Telemetry) {
    const bySpeed = video ? findOffset(video, logTelemetry) : undefined
    if (bySpeed && bySpeed.score >= GOOD_SYNC) {
      setSync({ ...bySpeed, method: 'speed' })
      setOffset(bySpeed.offset)
    } else if (video?.startTime !== undefined && logTelemetry.startTime !== undefined) {
      const offset = round1(logTelemetry.startTime - video.startTime)
      setSync({ offset, score: 1, method: 'clock' })
      setOffset(offset)
    } else {
      setSync(bySpeed && { ...bySpeed, method: 'speed' })
      if (bySpeed) setOffset(bySpeed.offset)
    }
  }

  async function openVideo(f: File) {
    setFile(f)
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })
    setGopro(undefined)
    setStatus({ kind: 'loading', what: 'Reading GoPro telemetry…' })
    try {
      const t = await readGoProTelemetry(f)
      setGopro(t)
      if (log) autoSync(t, log.telemetry)
      setStatus({ kind: 'ready' })
    } catch (e) {
      setStatus({ kind: 'error', message: String((e as Error).message ?? e) })
    }
  }

  async function openLog(f: File) {
    setStatus({ kind: 'loading', what: 'Reading data log…' })
    try {
      const loaded = await readLog(f)
      setLog(loaded)
      setOffset(0)
      autoSync(gopro, loaded.telemetry)
      setStatus({ kind: 'ready' })
    } catch (e) {
      setStatus({ kind: 'error', message: `Couldn't read ${f.name}: ${String((e as Error).message ?? e)}` })
    }
  }

  function remap(key: 'time' | Channel, column: number | undefined) {
    if (!log?.table) return
    const mapping = { ...log.mapping, [key]: column } as Mapping
    const telemetry = toTelemetry(log.table, mapping, log.name)
    setLog({ ...log, mapping, telemetry })
    if (key === 'time' || key === 'speed') autoSync(gopro, telemetry)
  }

  // Live preview: redraw the overlay on every presented video frame.
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !url) return
    const ctx = canvas.getContext('2d')!
    let handle = 0
    const draw = () => {
      if (video.videoWidth && canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawOverlay(ctx, canvas.width, canvas.height, timeline, video.currentTime, style)
      handle = video.requestVideoFrameCallback(draw)
    }
    draw()
    video.addEventListener('seeked', draw)
    video.addEventListener('loadedmetadata', draw)
    return () => {
      video.cancelVideoFrameCallback(handle)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('loadedmetadata', draw)
    }
  }, [url, timeline, style])

  async function runExport() {
    if (!file) return
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'exporting', progress: 0 })
    try {
      // Loaded on demand so the encoder library doesn't slow down the first page load.
      const { exportWithOverlay } = await import('./render/export')
      const blob = await exportWithOverlay({
        video: file,
        timeline,
        style,
        onProgress: (progress) => setStatus({ kind: 'exporting', progress }),
        signal: controller.signal,
      })
      if (blob) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = file.name.replace(/\.[^.]+$/, '') + '-overlay.mp4'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      }
      setStatus({ kind: 'ready' })
    } catch (e) {
      if (controller.signal.aborted || (e as Error).name === 'AbortError') setStatus({ kind: 'ready' })
      else setStatus({ kind: 'error', message: String((e as Error).message ?? e) })
    }
  }

  const exporting = status.kind === 'exporting'
  const busy = exporting || status.kind === 'loading'

  return (
    <main>
      <header>
        <h1>Super Simple Video Overlay</h1>
        <p className="muted">
          Add speed, throttle and brake to your driving videos. Everything runs in your browser; nothing is uploaded.
        </p>
      </header>

      <section className="controls">
        <label className="button">
          Open video
          <input
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && openVideo(e.target.files[0])}
          />
        </label>
        <label className="button">
          {log ? 'Change data log' : 'Add data log (OBD CSV, GPX, FIT)'}
          <input
            type="file"
            accept=".csv,.txt,.gpx,.fit,text/csv"
            hidden
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && openLog(e.target.files[0])}
          />
        </label>
        <div className="segmented" role="group" aria-label="Speed unit">
          {(['mph', 'kmh'] as const).map((u) => (
            <button key={u} aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {u === 'mph' ? 'mph' : 'km/h'}
            </button>
          ))}
        </div>
        <button className="primary" disabled={!file || busy} onClick={runExport}>
          Export MP4
        </button>
        {exporting && <button onClick={() => abortRef.current?.abort()}>Cancel</button>}
      </section>

      <p className="status" aria-live="polite">
        {status.kind === 'loading' && status.what}
        {status.kind === 'ready' && file && (gopro
          ? `GoPro GPS: ${gopro.samples.length.toLocaleString()} readings.`
          : 'No GoPro GPS in this video.')}
        {exporting && `Exporting… ${Math.round(status.progress * 100)}%`}
        {status.kind === 'error' && <span className="error">{status.message}</span>}
      </p>

      {file && (
        <section className="widgets" aria-label="Widgets">
          <span className="muted">Show:</span>
          {WIDGET_LABELS.map(({ key, label }) => (
            <label key={key} className={available[key] ? '' : 'unavailable'} title={available[key] ? undefined : 'No data for this yet'}>
              <input
                type="checkbox"
                disabled={!available[key]}
                checked={style.widgets[key]}
                onChange={(e) =>
                  setHidden((h) => {
                    const next = new Set(h)
                    if (e.target.checked) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
              />
              {label}
            </label>
          ))}
          <div className="segmented" role="group" aria-label="Overlay theme">
            {THEMES.map(({ key, label }) => (
              <button key={key} aria-pressed={theme === key} onClick={() => setTheme(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Speed style">
            {SPEED_LOOKS.map(({ key, label }) => (
              <button
                key={key}
                aria-pressed={look === key}
                disabled={!style.widgets.speed || theme === 'retro'}
                title={theme === 'retro' ? 'Retro HUD has its own speed gauge' : undefined}
                onClick={() => setLook(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {log && (
        <section className="panel">
          <h2>{log.name}</h2>
          <p className="muted">
            {log.telemetry.samples.length.toLocaleString()} readings over{' '}
            {formatDuration(log.telemetry.samples.at(-1)?.t ?? 0)}.{log.table && ' Check the columns below match your data.'}
          </p>
          {log.table && log.mapping && (
            <div className="mapping">
              {MAPPED.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <select
                    value={log.mapping![key] ?? ''}
                    onChange={(e) => remap(key, e.target.value === '' ? undefined : Number(e.target.value))}
                  >
                    {key !== 'time' && <option value="">None</option>}
                    {log.table!.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <h3>Sync</h3>
          <p className="muted">
            {sync?.method === 'clock' && 'Lined up using the times recorded in both files.'}
            {sync?.method === 'speed' && sync.score >= GOOD_SYNC &&
              `Lined up automatically by matching speed (match ${Math.round(sync.score * 100)}%).`}
            {sync?.method === 'speed' && sync.score < GOOD_SYNC &&
              `Best automatic match is weak (${Math.round(sync.score * 100)}%). Check the overlay against the video and adjust.`}
            {!sync && (gopro
              ? 'Couldn’t match the speed traces automatically. Set the offset by hand.'
              : 'No GoPro GPS to match against. Set the offset by hand.')}
          </p>
          <div className="offset">
            <span>Log starts at</span>
            <button onClick={() => setOffset((o) => round1(o - 1))}>−1s</button>
            <button onClick={() => setOffset((o) => round1(o - 0.1))}>−0.1s</button>
            <input
              type="number"
              step={0.1}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value) || 0)}
              aria-label="Offset in seconds"
            />
            <button onClick={() => setOffset((o) => round1(o + 0.1))}>+0.1s</button>
            <button onClick={() => setOffset((o) => round1(o + 1))}>+1s</button>
            <span className="muted">seconds into the video</span>
            {gopro && (
              <button onClick={() => autoSync(gopro, log.telemetry)}>Auto-sync</button>
            )}
          </div>
          {style.pedals.brake && style.pedals.brakeEstimated && (
            <p className="muted">
              Your log has no brake data (most cars don’t report it over OBD-II), so braking is estimated from how quickly you slow down.
            </p>
          )}
        </section>
      )}

      {url && (
        <div className="stage">
          <video ref={videoRef} src={url} controls playsInline />
          <canvas ref={canvasRef} />
        </div>
      )}
    </main>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m} min ${s} s` : `${s} s`
}
