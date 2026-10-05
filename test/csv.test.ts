import { describe, expect, test } from 'vitest'
import { guessMapping, parseCsv, parseTime, toTable, toTelemetry } from '../src/telemetry/csv'

function load(text: string) {
  const table = toTable(parseCsv(text))
  const mapping = guessMapping(table.headers)
  return { table, mapping, telemetry: toTelemetry(table, mapping, 'test') }
}

describe('CSV logs', () => {
  test('Torque Pro: picks device time and OBD speed in km/h', () => {
    const { table, mapping, telemetry } = load(
      [
        'GPS Time, Device Time, Longitude, Latitude,GPS Speed (Meters/second), Altitude,Speed (OBD)(km/h),Engine RPM(rpm),Throttle Position(Manifold)(%)',
        'Sun Oct 05 14:22:01 PDT 2026,05-Oct-2026 14:22:01.100,-118.1,34.2,10,500,36,2100,18.5',
        'Sun Oct 05 14:22:01 PDT 2026,05-Oct-2026 14:22:01.600,-118.1,34.2,10.5,501,38,2200,25',
        'Sun Oct 05 14:22:02 PDT 2026,05-Oct-2026 14:22:02.100,-,-,-,-,40,2300,-',
      ].join('\n'),
    )
    expect(table.headers[mapping.time]).toBe('Device Time')
    expect(table.headers[mapping.speed!]).toBe('Speed (OBD)(km/h)')
    expect(table.headers[mapping.rpm!]).toBe('Engine RPM(rpm)')
    expect(table.headers[mapping.throttle!]).toBe('Throttle Position(Manifold)(%)')
    const s = telemetry.samples
    expect(s.map((x) => x.t)).toEqual([0, 0.5, 1])
    expect(s[0].speed).toBeCloseTo(10) // 36 km/h
    expect(s[1].throttle).toBe(25)
    expect(s[2].throttle).toBeUndefined()
  })

  test('Car Scanner: pivots one-row-per-reading logs', () => {
    const { mapping, telemetry, table } = load(
      [
        '"SECONDS";"PID";"VALUE";"UNITS"',
        '"0.012";"Vehicle speed";"50";"km/h"',
        '"0.031";"Engine RPM";"1800";"rpm"',
        '"0.050";"Accelerator pedal position D";"12";"%"',
        '"1.010";"Vehicle speed";"54";"km/h"',
        '"1.040";"Engine RPM";"1900";"rpm"',
      ].join('\n'),
    )
    expect(table.headers[mapping.speed!]).toBe('Vehicle speed (km/h)')
    expect(table.headers[mapping.throttle!]).toBe('Accelerator pedal position D (%)')
    const s = telemetry.samples
    expect(s.map((x) => x.t)).toEqual([0, 0.1, 1])
    // Each row only had some readings; the rest are interpolated.
    expect(s[0].rpm).toBe(1800)
    expect(s[1].speed).toBeCloseTo(14) // 50.4 km/h
    expect(s[2].speed).toBeCloseTo(15)
    expect(s[2].throttle).toBeUndefined()
  })

  test('RaceChrono-style: names with a units row, metadata above', () => {
    const { table, mapping, telemetry } = load(
      [
        'This file is created using RaceChrono',
        'Format,3',
        'Session title,"Canyon run"',
        '',
        'Timestamp,Elapsed time,Speed,Latitude,Longitude',
        'unix time,s,m/s,deg,deg',
        'gps,gps,gps,gps,gps',
        '1791230000.0,0.0,20,34.1,-118.2',
        '1791230000.5,0.5,21,34.1,-118.2',
      ].join('\n'),
    )
    expect(table.headers[mapping.time]).toBe('Elapsed time (s)')
    expect(table.headers[mapping.speed!]).toBe('Speed (m/s)')
    expect(telemetry.samples[1].speed).toBe(21)
    expect(telemetry.samples[1].t).toBe(0.5)
  })

  test('brake switch columns become 0 or 100', () => {
    const { telemetry } = load(['time,speed_mph,brake', '0,30,0', '1,28,1'].join('\n'))
    expect(telemetry.samples.map((s) => s.brake)).toEqual([0, 100])
    expect(telemetry.samples[0].speed).toBeCloseTo(13.41, 1)
  })

  test('parseTime handles seconds, epoch ms, clock times and dates', () => {
    expect(parseTime('12.5')).toBe(12.5)
    expect(parseTime('1791230000123')).toBeCloseTo(1791230000.123)
    expect(parseTime('01:02:03.5')).toBe(3723.5)
    expect(parseTime('05-Oct-2026 14:22:01.100')).toBeTypeOf('number')
    expect(parseTime('nope')).toBeUndefined()
  })
})
