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

The image comes from `/dashboard?location=<lat>,<lon>` on the website, loaded in headless Chromium. Set `WEBSITE_URL` (default `https://edgewarn.ashk3000.com`) and `CHROME_PATH` (default `/usr/bin/chromium`) to change either.

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
