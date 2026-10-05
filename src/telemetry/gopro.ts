import { findGpmdSamples, readSample } from './mp4'
import { parseGpmf } from './gpmf'
import type { Sample, Telemetry } from './types'

/**
 * Reads GPS telemetry embedded in a GoPro video. Readings inside each metadata
 * sample are spread evenly across that sample's duration.
 * Returns undefined when the file has no GoPro metadata track or no GPS lock.
 */
export async function readGoProTelemetry(file: Blob): Promise<Telemetry | undefined> {
  const meta = await findGpmdSamples(file)
  if (meta.length === 0) return undefined
  const samples: Sample[] = []
  let startTime: number | undefined
  for (const m of meta) {
    const { gps, gpsTime } = parseGpmf(await readSample(file, m))
    if (startTime === undefined && gpsTime !== undefined && gps.length > 0) startTime = gpsTime - m.time
    gps.forEach((fix, i) => {
      samples.push({ t: m.time + (m.duration * i) / gps.length, ...fix })
    })
  }
  if (samples.length === 0) return undefined
  return { source: 'GoPro GPS', samples, startTime }
}
