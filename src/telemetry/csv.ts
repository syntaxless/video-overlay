// CSV import for data loggers: OBD-II phone apps (Car Scanner, Torque Pro,
// OBD Fusion), RaceChrono, RaceBox and any CSV with a time column.

import { CHANNELS, type Channel, type Sample, type Telemetry } from './types'

/** Splits CSV text into rows of cells. Handles quotes and , ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'))
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) {
      row.push(cell.trim())
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell.trim())
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

/** A log as named columns. Values that aren't numbers are kept as text for the time column. */
export interface LogTable {
  headers: string[]
  rows: string[][]
}

export type Mapping = { time: number } & Partial<Record<Channel, number>>

const isNumeric = (s: string) => s !== '' && !Number.isNaN(Number(s.replace(',', '.')))

/**
 * Turns parsed CSV rows into a table with one column per value. Recognises
 * Car Scanner's long layout (one row per reading: seconds, PID, value, units)
 * and pivots it; otherwise finds the header row above the first data rows.
 */
export function toTable(rows: string[][]): LogTable {
  const longHeader = rows.findIndex((r) => r.length >= 3 && /^seconds?$/i.test(r[0]) && /^pid$/i.test(r[1]))
  if (longHeader !== -1) return pivotLong(rows.slice(longHeader + 1))

  const isData = (r: string[]) => r.filter(isNumeric).length >= Math.max(2, r.length / 2)
  const firstData = rows.findIndex((r, i) => i > 0 && isData(r))
  if (firstData === -1) throw new Error('Could not find any data rows in this CSV.')
  // Some loggers (RaceChrono) put unit and source rows under the column names.
  // The names are the top row of the block of same-width text rows above the data.
  const width = rows[firstData].length
  let h = firstData - 1
  while (h > 0 && rows[h - 1].length === width && !isData(rows[h - 1])) h--
  // Fold a units row into the names, e.g. "Speed" + "km/h" becomes "Speed (km/h)".
  const units = h + 1 < firstData ? rows[h + 1] : undefined
  const headers = rows[h].map((name, i) => (units?.[i] && !isNumeric(units[i]) ? `${name} (${units[i]})` : name))
  // Keep sparse rows too (loggers write '-' for values they didn't read that time).
  return { headers, rows: rows.slice(firstData).filter((r) => r.length >= width / 2 && r.some(isNumeric)) }
}

function pivotLong(rows: string[][]): LogTable {
  const names: string[] = []
  const byTime = new Map<string, Map<string, string>>()
  for (const [seconds, pid, value, units] of rows) {
    if (!isNumeric(seconds)) continue
    const name = units ? `${pid} (${units})` : pid
    if (!names.includes(name)) names.push(name)
    // Readings for different PIDs arrive at slightly different times. Bucket
    // to 0.1 s so near-simultaneous readings share a row.
    const key = (Math.round(Number(seconds) * 10) / 10).toFixed(1)
    if (!byTime.has(key)) byTime.set(key, new Map())
    byTime.get(key)!.set(name, value)
  }
  const times = [...byTime.keys()].sort((a, b) => Number(a) - Number(b))
  return {
    headers: ['Seconds', ...names],
    rows: times.map((t) => [t, ...names.map((n) => byTime.get(t)!.get(n) ?? '')]),
  }
}

const PATTERNS: [Channel | 'time', RegExp, RegExp?][] = [
  ['time', /^(time|seconds?|timestamp|elapsed|device time|gps time|time \(s(ec)?\)|utc)/i, /\blap|sector|delta/i],
  ['speed', /speed|velocity|^vss/i, /wind|fan|engine|limit|set/i],
  ['rpm', /rpm|engine speed|revs/i],
  ['throttle', /throttle|accelerator|pedal pos|tps/i, /commanded|relative|actuator/i],
  ['brake', /brake/i, /temp|wear|lamp/i],
  ['lat', /^lat/i],
  ['lon', /^(lon|lng)/i],
  ['alt', /alt|elevation|height/i],
]

const PREFER: Partial<Record<Channel | 'time', RegExp>> = {
  speed: /obd|vehicle/i,
  time: /device time|seconds|elapsed|time \(s/i,
}

/** Guesses which column holds which channel from the header names. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Partial<Mapping> = {}
  for (const [channel, include, exclude] of PATTERNS) {
    const candidates = headers
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => include.test(h) && !exclude?.test(h) && !Object.values(mapping).includes(i))
    if (candidates.length === 0) continue
    // Prefer the OBD reading over GPS for speed, since that's why people log OBD,
    // and the phone's clock over GPS time, which usually only has whole seconds.
    const preferred = PREFER[channel]
    const pick = (preferred && candidates.find(({ h }) => preferred.test(h))) || candidates[0]
    mapping[channel] = pick.i
  }
  if (mapping.time === undefined) mapping.time = 0
  return mapping as Mapping
}

/** Multiplier that converts a speed column to m/s, read from its header. */
export function speedFactor(header: string): number {
  if (/mph|mi\/h|miles/i.test(header)) return 0.44704
  if (/m\/s|meters\/second|metres\/second|mps/i.test(header)) return 1
  return 1 / 3.6 // km/h is the OBD-II default
}

/** Parses a time cell to seconds: plain seconds, epoch seconds or milliseconds, or a date string. */
export function parseTime(cell: string): number | undefined {
  if (isNumeric(cell)) {
    const n = Number(cell.replace(',', '.'))
    return n > 1e11 ? n / 1000 : n
  }
  const hms = cell.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:[.,]\d+)?)$/)
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3].replace(',', '.'))
  const ms = Date.parse(cell.replace(/(\d{2})-(\w{3})-(\d{4})/, '$1 $2 $3'))
  return Number.isNaN(ms) ? undefined : ms / 1000
}

/** Builds telemetry from a table. Time starts at 0 at the first row. */
export function toTelemetry(table: LogTable, mapping: Mapping, source: string): Telemetry {
  const speedScale = mapping.speed !== undefined ? speedFactor(table.headers[mapping.speed]) : 1
  const samples: Sample[] = []
  let t0: number | undefined
  for (const row of table.rows) {
    const t = parseTime(row[mapping.time] ?? '')
    if (t === undefined) continue
    t0 ??= t
    const s: Sample = { t: t - t0 }
    for (const [channel, col] of Object.entries(mapping) as [Channel | 'time', number][]) {
      if (channel === 'time' || col === undefined) continue
      const cell = row[col] ?? ''
      if (!isNumeric(cell)) continue
      let v = Number(cell.replace(',', '.'))
      if (channel === 'speed') v *= speedScale
      s[channel] = v
    }
    samples.push(s)
  }
  samples.sort((a, b) => a.t - b.t)
  fillGaps(samples)
  // Absolute times (epoch or dates) let us look up the weather for the drive.
  const startTime = t0 !== undefined && t0 > 1e8 ? t0 : undefined
  // Brake columns are often on/off switches (0/1); show those as 0 or 100%.
  if (mapping.brake !== undefined && samples.every((s) => s.brake === undefined || s.brake <= 1)) {
    for (const s of samples) if (s.brake !== undefined) s.brake *= 100
  }
  return { source, samples, startTime }
}

/** Longest gap (s) bridged by interpolation; longer gaps mean the logger lost the reading. */
const MAX_GAP = 5

/**
 * OBD apps read one value at a time, so most rows hold only some channels.
 * Fills each channel's missing values by interpolating between its neighbours.
 */
function fillGaps(samples: Sample[]) {
  for (const k of CHANNELS) {
    let prev = -1
    for (let i = 0; i < samples.length; i++) {
      if (samples[i][k] === undefined) continue
      if (prev !== -1 && i - prev > 1) {
        const a = samples[prev]
        const b = samples[i]
        if (b.t - a.t <= MAX_GAP) {
          for (let j = prev + 1; j < i; j++) {
            const f = (samples[j].t - a.t) / (b.t - a.t)
            samples[j][k] = a[k]! + (b[k]! - a[k]!) * f
          }
        }
      }
      prev = i
    }
  }
}

export async function readCsvTelemetry(file: File): Promise<{ table: LogTable; mapping: Mapping; telemetry: Telemetry }> {
  const table = toTable(parseCsv(await file.text()))
  const mapping = guessMapping(table.headers)
  return { table, mapping, telemetry: toTelemetry(table, mapping, file.name) }
}
