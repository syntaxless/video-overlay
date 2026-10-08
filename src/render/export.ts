import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  type Target,
} from 'mediabunny'
import { encodeAttempts, isEncoderConfigError, type EncodeAttempt } from './encode-plan'
import { drawOverlay, type OverlayStyle } from '../overlay/overlay'
import type { Timeline } from '../telemetry/timeline'

export interface ExportOptions {
  video: File
  timeline: Timeline
  style: OverlayStyle
  onProgress: (fraction: number) => void
  signal: AbortSignal
}

/**
 * Re-encodes the video with the overlay burned into every frame. Audio is
 * copied through. Writes straight to disk when the browser supports the
 * File System Access API, otherwise returns the file as a Blob.
 *
 * If the browser's encoder rejects the settings, the export is retried with
 * progressively safer ones (see encodeAttempts) before giving up.
 */
export async function exportWithOverlay(opts: ExportOptions): Promise<Blob | undefined> {
  const input = new Input({ source: new BlobSource(opts.video), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) throw new Error('This file has no video track.')
  const stats = await videoTrack.computePacketStats(120)
  const attempts = encodeAttempts(videoTrack.displayWidth, videoTrack.displayHeight, stats.averagePacketRate)

  const name = opts.video.name.replace(/\.[^.]+$/, '') + '-overlay.mp4'
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker
  const handle = picker
    ? await picker({ suggestedName: name, types: [{ accept: { 'video/mp4': ['.mp4'] } }] })
    : undefined

  let lastError: unknown
  for (const attempt of attempts) {
    opts.signal.throwIfAborted()
    try {
      return await exportAttempt(opts, input, handle, attempt)
    } catch (e) {
      if (opts.signal.aborted || !isEncoderConfigError(e)) throw e
      console.warn('Encoder rejected export settings, trying safer ones', attempt, e)
      lastError = e
    }
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : ''
  throw new Error(`This browser could not encode the video with any of the export settings tried${detail}. Try updating Chrome or Edge.`)
}

async function exportAttempt(
  opts: ExportOptions,
  input: Input,
  handle: FileSystemFileHandle | undefined,
  attempt: EncodeAttempt,
): Promise<Blob | undefined> {
  let target: Target
  let writable: FileSystemWritableFileStream | undefined
  if (handle) {
    writable = await handle.createWritable()
    target = new StreamTarget(writable, { chunked: true })
  } else {
    target = new BufferTarget()
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target })

  let canvas: OffscreenCanvas | undefined
  let ctx: OffscreenCanvasRenderingContext2D | undefined

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        forceTranscode: true,
        quality: new Quality({ quality: 'high', preferBitrate: attempt.preferBitrate }),
        hardwareAcceleration: attempt.hardwareAcceleration,
        frameRate: attempt.frameRate,
        processedWidth: attempt.width,
        processedHeight: attempt.height,
        process: (sample) => {
          if (!canvas) {
            canvas = new OffscreenCanvas(attempt.width, attempt.height)
            ctx = canvas.getContext('2d')!
          }
          sample.draw(ctx!, 0, 0, canvas.width, canvas.height)
          drawOverlay(ctx!, canvas.width, canvas.height, opts.timeline, sample.timestamp, opts.style)
          return canvas
        },
      },
    })
    if (!conversion.isValid) {
      const error = new Error('This browser cannot re-encode this video. Try Chrome or Edge.')
      // Only a missing encoder for these settings is worth retrying with others.
      if (conversion.discardedTracks.some((t) => t.reason === 'no_encodable_target_codec')) error.name = 'NotSupportedError'
      throw error
    }
    conversion.onProgress = (p) => opts.onProgress(p)
    const cancel = () => void conversion.cancel()
    opts.signal.addEventListener('abort', cancel)
    try {
      await conversion.execute()
    } finally {
      opts.signal.removeEventListener('abort', cancel)
    }
  } catch (e) {
    await writable?.abort().catch(() => {})
    throw e
  }
  if (target instanceof BufferTarget) return new Blob([target.buffer!], { type: 'video/mp4' })
  return undefined
}
