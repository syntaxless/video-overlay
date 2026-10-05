import { useEffect, useRef, useState } from 'react'
import { readGoProTelemetry } from './telemetry/gopro'
import { sampleAt, type Telemetry } from './telemetry/types'
import { drawSpeed, type SpeedUnit } from './overlay/speed'

const MAX_SPEED: Record<SpeedUnit, number> = { mph: 140, kmh: 220 }

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'exporting'; progress: number }
  | { kind: 'error'; message: string }

export default function App() {
  const [file, setFile] = useState<File>()
  const [url, setUrl] = useState<string>()
  const [telemetry, setTelemetry] = useState<Telemetry>()
  const [unit, setUnit] = useState<SpeedUnit>('mph')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController>(undefined)

  async function openFile(f: File) {
    setFile(f)
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })
    setTelemetry(undefined)
    setStatus({ kind: 'loading' })
    try {
      setTelemetry(await readGoProTelemetry(f))
      setStatus({ kind: 'ready' })
    } catch (e) {
      setStatus({ kind: 'error', message: String((e as Error).message ?? e) })
    }
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
      const reading = telemetry ? sampleAt(telemetry, video.currentTime) : undefined
      drawSpeed(ctx, canvas.height, reading, { unit, max: MAX_SPEED[unit] })
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
  }, [url, telemetry, unit])

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
        telemetry,
        speed: { unit, max: MAX_SPEED[unit] },
        offset: 0,
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

  return (
    <main>
      <header>
        <h1>Super Simple Video Overlay</h1>
        <p className="muted">Add a speed overlay to your GoPro footage. Everything runs in your browser; nothing is uploaded.</p>
      </header>

      <section className="controls">
        <label className="button">
          Open video
          <input
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}
          />
        </label>
        <div className="segmented" role="group" aria-label="Speed unit">
          {(['mph', 'kmh'] as const).map((u) => (
            <button key={u} aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {u === 'mph' ? 'mph' : 'km/h'}
            </button>
          ))}
        </div>
        <button className="primary" disabled={!file || exporting || status.kind === 'loading'} onClick={runExport}>
          Export MP4
        </button>
        {exporting && <button onClick={() => abortRef.current?.abort()}>Cancel</button>}
      </section>

      <p className="status" aria-live="polite">
        {status.kind === 'loading' && 'Reading telemetry…'}
        {status.kind === 'ready' && file && (telemetry
          ? `${telemetry.source}: ${telemetry.samples.length.toLocaleString()} readings.`
          : 'No GoPro GPS found in this file. The video will export without speed data.')}
        {exporting && `Exporting… ${Math.round(status.progress * 100)}%`}
        {status.kind === 'error' && <span className="error">{status.message}</span>}
      </p>

      {url && (
        <div className="stage">
          <video ref={videoRef} src={url} controls playsInline />
          <canvas ref={canvasRef} />
        </div>
      )}
    </main>
  )
}
