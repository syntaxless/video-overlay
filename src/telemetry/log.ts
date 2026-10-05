import { readCsvTelemetry, type LogTable, type Mapping } from './csv'
import { parseFit } from './fit'
import { parseGpx } from './gpx'
import type { Telemetry } from './types'

export interface LoadedLog {
  name: string
  /** Present for CSV logs, whose columns can be remapped. */
  table?: LogTable
  mapping?: Mapping
  telemetry: Telemetry
}

/** Reads a data log by file type: CSV, GPX or Garmin FIT. */
export async function readLog(file: File): Promise<LoadedLog> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'gpx') return { name: file.name, telemetry: parseGpx(await file.text(), file.name) }
  if (ext === 'fit') return { name: file.name, telemetry: parseFit(await file.arrayBuffer(), file.name) }
  const { table, mapping, telemetry } = await readCsvTelemetry(file)
  return { name: file.name, table, mapping, telemetry }
}
