# Super Simple Video Overlay

Add live data overlays (speed now; throttle, brake, RPM, elevation, weather and a route map next) to driving videos. Runs entirely in the browser: your footage is never uploaded.

## What works today

- Open a GoPro MP4 (HERO5 and later, except HERO12, which has no GPS). The app reads the GPS telemetry embedded in the file.
- Add a data log: an OBD-II or data-logger CSV (Torque Pro, Car Scanner, OBD Fusion, RaceChrono, RaceBox or any CSV with a time column), a GPX track, or a Garmin FIT file. CSV columns are detected automatically and can be changed.
- The log is lined up with the video automatically by matching its speed against the GoPro's GPS speed. If that match is weak and both files have real clock times, the clocks are used instead. Buttons nudge it by hand.
- A GPX or FIT track also drives the map, elevation and compass for videos without GoPro GPS.
- Route map with a moving dot, elevation with a profile of the drive, compass heading, and the weather at the start of the drive. Weather and terrain height come from [Open-Meteo](https://open-meteo.com) (free, no key); only the route's coordinates and date are sent.
- Turn each widget on or off. Imperial or metric follows the mph / km/h switch.
- Live preview with a speedometer (mph or km/h), RPM, and throttle and brake bars. Most cars don't report brake over OBD-II, so when the log has no brake column, braking is estimated from how quickly you slow down (marked "est.").
- Export an MP4 with the overlay burned in. Audio is kept. In Chrome and Edge the file is written straight to disk, so long 4K clips don't need to fit in memory.

Best in Chrome or Edge. Other browsers may lack the video encoding support it needs.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run lint
npm run build
```

To also test against real GoPro clips, point `GOPRO_SAMPLES` at a folder of them (for example the [gpmf-parser samples](https://github.com/gopro/gpmf-parser/tree/main/samples)):

```sh
GOPRO_SAMPLES=~/gopro-samples npm test
```

## How it works

- `src/telemetry/mp4.ts` finds GoPro's `gpmd` metadata track in the MP4 and reads only those bytes.
- `src/telemetry/gpmf.ts` parses the GPMF telemetry (GPS5 and GPS9).
- `src/telemetry/csv.ts` reads data-logger CSVs, `sync.ts` lines a log up with the video by correlating speed, and `timeline.ts` merges both sources and estimates braking.
- `src/overlay/` holds the widgets. Each one is a plain function that draws on a canvas, so preview and export use the same code.
- `src/render/export.ts` decodes, draws and re-encodes every frame with [Mediabunny](https://mediabunny.dev) and WebCodecs.

## Roadmap

1. Layout editor and presets.

## Licence

MIT
