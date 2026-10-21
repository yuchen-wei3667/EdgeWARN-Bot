# EdgeWARN-Bot
Automated weather bot with Discord/Instagram capabilities that generates forecast images from the EdgeWARN website dashboard

Layout:
- `src/backend/` holds the forecast image (`forecast/`), place lookup (`sources/`), the CLI, and the HTTP server.
- `src/connectors/` is reserved for social media connectors and is empty for now.
- `assets/` holds the EdgeWARN logo.

Current MVP:
- Screenshots the website dashboard for any US place, cropped to the current conditions card and the 12-hour strip. The sidebar, header, banners, radar, and outlooks are left out.

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
```

The image is the website's `/automation/daily` card (1080×1350 JPEG, a public route). Set `WEBSITE_URL` (default `https://edgewarn.vercel.app`) to point elsewhere. Optional `--school on|off` and `--scroll` pass through to the route.

The HTTP server and Instagram connector still screenshot `/dashboard?location=<lat>,<lon>` in headless Chromium (`CHROME_PATH`, default `/usr/bin/chromium`).

HTTP server:

```bash
npm run server:dev
```

The server listens on `http://0.0.0.0:6767` by default and returns the image at `/forecast.png?place=Oklahoma%20City,%20OK` (or `?lat=..&lon=..&name=..`).

## Instagram posting

`src/connectors/ig` publishes images to Instagram as feed posts or stories through the Instagram Graph API (Instagram Login).

1. Create a Meta app with Instagram Login and the `instagram_business_content_publish` permission, then generate a long-lived token.
2. Set `IG_ACCESS_TOKEN`, `IG_USER_ID`, and `PUBLIC_BASE_URL` (the HTTPS address Instagram can reach this server at) in `.env`.
3. Run `npm run server:dev`, then `npm run ig -- --kind story --forecast "Oklahoma City, OK"` or `--kind feed --caption "..."`.

Instagram fetches the image by URL, so the server's `/media/<name>.jpg` route serves the rendered JPEGs from `OUTPUT_DIR`. Stories do not take captions.

## Daily post

`npm run daily` runs a loop that, every day in `DAILY_TIMEZONE` (default `America/New_York`), posts the website's `/automation/daily` card for `DAILY_PLACE` to the Instagram feed at `DAILY_FEED_TIME` (default 06:20) and the story card at `DAILY_STORY_TIME` (default 06:50) (caption from `DAILY_CAPTION`, or generated from the forecast; see below). Instagram downloads the image from the website directly, so nothing is saved or served locally and `PUBLIC_BASE_URL` isn't needed. A run missed while the process is down is skipped.

- `npm run daily -- --now` posts once immediately and exits; add `--dry-run` to print the card URL and caption without publishing.
- Needs `DAILY_PLACE`, `IG_ACCESS_TOKEN`, and `IG_USER_ID` in `.env`.
- To keep it running, build with `npm run build` and run `npm run daily:start` under systemd or pm2.

### Generated captions

Without `DAILY_CAPTION`, `src/backend/forecast/caption.ts` writes the feed caption from the Open-Meteo forecast for `DAILY_PLACE` and any active NWS alerts (both free, no keys). It is rule-based and deterministic: the data picks the angle (an NWS alert, snow, rain at dismissal, wind, a big warmup, a cold morning, a temperature change from yesterday or tomorrow, a pleasant day, or a routine summary), and the date rotates the wording, the Edgemont/Scarsdale name, and the questions, so back-to-back posts differ and a question is never asked two posts in a row. Active NWS watches, warnings and advisories take over the caption with no questions or sharing prompts, and model-only storm or wind risks are labeled as not NWS alerts. If the forecast can't be loaded the caption falls back to a short keyword line.

- `npm run daily -- --now --dry-run` prints the caption and which angle led it (`Caption topic: ...`), which you can match against post insights.
- `CAPTION_STYLE=plain` drops the questions and sharing prompts, as a baseline for comparing against the default.
