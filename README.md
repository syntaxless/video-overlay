# Super Simple Video Overlay

Add live data overlays (speed now; throttle, brake, RPM, elevation, weather and a route map next) to driving videos. Runs entirely in the browser: your footage is never uploaded.

## What works today

- Open a GoPro MP4 (HERO5 and later, except HERO12, which has no GPS). The app reads the GPS telemetry embedded in the file.
- Live preview with a speedometer in mph or km/h.
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
- `src/overlay/` holds the widgets. Each one is a plain function that draws on a canvas, so preview and export use the same code.
- `src/render/export.ts` decodes, draws and re-encodes every frame with [Mediabunny](https://mediabunny.dev) and WebCodecs.

## Roadmap

1. OBD-II CSV import (Car Scanner, Torque Pro, OBD Fusion, RaceChrono) with automatic sync to the GoPro speed.
2. GPX / FIT / GPS-logger CSV import.
3. Widgets: throttle, brake (from deceleration when the car doesn't report it), RPM, elevation, weather, compass, route map.
4. Layout editor and presets.

## Licence

MIT
