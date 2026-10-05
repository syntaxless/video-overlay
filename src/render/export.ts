import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type Target,
} from 'mediabunny'
import { drawSpeed, type SpeedStyle } from '../overlay/speed'
import { sampleAt, type Telemetry } from '../telemetry/types'

export interface ExportOptions {
  video: File
  telemetry: Telemetry | undefined
  speed: SpeedStyle
  /** Seconds added to video time before looking up telemetry. */
  offset: number
  onProgress: (fraction: number) => void
  signal: AbortSignal
}

/**
 * Re-encodes the video with the overlay burned into every frame. Audio is
 * copied through. Writes straight to disk when the browser supports the
 * File System Access API, otherwise returns the file as a Blob.
 */
export async function exportWithOverlay(opts: ExportOptions): Promise<Blob | undefined> {
  const input = new Input({ source: new BlobSource(opts.video), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) throw new Error('This file has no video track.')

  const name = opts.video.name.replace(/\.[^.]+$/, '') + '-overlay.mp4'
  let target: Target
  let writable: FileSystemWritableFileStream | undefined
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker
  if (picker) {
    const handle = await picker({ suggestedName: name, types: [{ accept: { 'video/mp4': ['.mp4'] } }] })
    writable = await handle.createWritable()
    target = new StreamTarget(writable, { chunked: true })
  } else {
    target = new BufferTarget()
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target })

  let canvas: OffscreenCanvas | undefined
  let ctx: OffscreenCanvasRenderingContext2D | undefined

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      forceTranscode: true,
      process: (sample) => {
        if (!canvas) {
          canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight)
          ctx = canvas.getContext('2d')!
        }
        sample.draw(ctx!, 0, 0, canvas.width, canvas.height)
        const reading = opts.telemetry ? sampleAt(opts.telemetry, sample.timestamp + opts.offset) : undefined
        drawSpeed(ctx!, canvas.height, reading, opts.speed)
        return canvas
      },
    },
  })
  if (!conversion.isValid) {
    throw new Error('This browser cannot re-encode this video. Try Chrome or Edge.')
  }
  conversion.onProgress = (p) => opts.onProgress(p)
  opts.signal.addEventListener('abort', () => void conversion.cancel())

  try {
    await conversion.execute()
  } catch (e) {
    await writable?.abort().catch(() => {})
    throw e
  }
  if (target instanceof BufferTarget) return new Blob([target.buffer!], { type: 'video/mp4' })
  return undefined
}
