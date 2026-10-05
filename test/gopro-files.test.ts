// Runs against real GoPro clips when GOPRO_SAMPLES points at a folder of them,
// e.g. the samples in https://github.com/gopro/gpmf-parser/tree/main/samples
import { existsSync, openAsBlob, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readGoProTelemetry } from '../src/telemetry/gopro'

const dir = process.env.GOPRO_SAMPLES
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => /\.mp4$/i.test(f)) : []

describe.skipIf(files.length === 0)('GoPro sample files', () => {
  for (const f of files) {
    test(f, async () => {
      const telemetry = await readGoProTelemetry(await openAsBlob(join(dir!, f)))
      if (!telemetry) return // clip recorded without a GPS lock
      // GPS time is UTC from the satellites, so it must be a sane date.
      expect(telemetry.startTime).toBeGreaterThan(Date.UTC(2015, 0, 1) / 1000)
      const { samples } = telemetry
      expect(samples.length).toBeGreaterThan(0)
      for (let i = 1; i < samples.length; i++) expect(samples[i].t).toBeGreaterThanOrEqual(samples[i - 1].t)
      for (const s of samples) {
        expect(Math.abs(s.lat!)).toBeLessThanOrEqual(90)
        expect(Math.abs(s.lon!)).toBeLessThanOrEqual(180)
        expect(s.speed!).toBeGreaterThanOrEqual(0)
      }
    })
  }
})
