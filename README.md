# EdgeWARN-Bot
Automated weather bot with Discord/Instagram capabilities that generates daily forecast images from National Weather Service data

Layout:
- `src/backend/` holds the logic and rendering: the daily forecast (`forecast/`), the data sources it reads (`sources/`: the National Weather Service and geocoding), the CLI, and the HTTP server.
- `src/connectors/` is reserved for social media connectors and is empty for now.
- `assets/` holds the Sora font files and logo used by the forecast image.
- `design/mockups/` holds the forecast design mockups.

Current MVP:
- Generates a daily forecast PNG (1080 × 1350) for any US place, today only (tomorrow when under four hours of today remain) from National Weather Service data

The alert bulletin renderer (EdgeWARN alerts over EWMRS radar) has been removed for now. It is still in git history.

Quick start:

```bash
npm install
```

Build output:

```bash
npm run build
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
