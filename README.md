# EdgeWARN-Bot
Automated alert bot with Discord/Instagram capabilities using the EdgeWARN and EWMRS APIs

Layout:
- `src/backend/` holds the logic and rendering: the alert bulletin (`alerts/`), the daily forecast (`forecast/`), the data sources it reads (`sources/`: EdgeWARN, EWMRS, and the National Weather Service), the CLI, and the HTTP server.
- `src/connectors/` is reserved for social media connectors and is empty for now.
- `assets/` holds the Sora font files and logo used by the forecast image.
- `design/mockups/` holds the forecast design mockups.

Current MVP:
- Fetches official EdgeWARN alerts from `api.edgewarn.ashk3000.com`
- Pulls `CompRefQC` radar tiles from `ewmrs.edgewarn.ashk3000.com`
- Renders a PNG with an unlabeled Carto basemap, visible CompRefQC tiles, and the alert polygon
- Generates a daily forecast PNG (1080 × 1350) for any US place, today only (tomorrow when under four hours of today remain) from National Weather Service data

Quick start:

```bash
npm install
npm run dev -- --alert-id "urn:oid:..."
```

CLI options:
- `--alert-id <id>`: render a specific alert; defaults to the first alert in the latest EdgeWARN timestamp
- `--timestamp <YYYYMMDD-HHMMSS>`: force a specific EdgeWARN alert timestamp
- `--output <file.png>`: write the PNG to a specific path

Build output:

```bash
npm run build
npm start -- --output output/alert.png
```

Daily forecast image:

```bash
npm run forecast -- --place "Oklahoma City, OK" --output output/forecast.png
npm run forecast -- --lat 39.74 --lon -104.99 --name "Denver, CO"
npm run forecast -- --samples   # hazard previews from made-up data, in output/samples
```
When the day carries a severe storm, flood, heat, or winter risk, the graphic gets its own colors and a hazard-specific stat. Risks are worked out from the NWS hourly forecast (gusts, rain and snow totals, heat index, ice), so they are not official warnings.


HTTP server:

```bash
npm run server:dev
```

The server listens on `http://0.0.0.0:6767` by default.

The server also returns the daily forecast image at `/forecast.png?place=Oklahoma%20City,%20OK` (or `?lat=..&lon=..&name=..`).
