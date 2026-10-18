import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  // The website whose dashboard the forecast image screenshots, and the Chromium that loads it.
  websiteUrl: process.env.WEBSITE_URL ?? "https://edgewarn.ashk3000.com",
  chromePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
  geocodingApi: process.env.GEOCODING_API ?? "https://geocoding-api.open-meteo.com",
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "output"),
  serverHost: process.env.SERVER_HOST ?? "0.0.0.0",
  serverPort: toPositiveInt(process.env.SERVER_PORT, 6767),
  // Instagram publishing. Instagram fetches images from publicBaseUrl, so it must reach this server over HTTPS.
  igAccessToken: process.env.IG_ACCESS_TOKEN,
  igUserId: process.env.IG_USER_ID,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  // Daily Instagram post (npm run daily).
  dailyPlace: process.env.DAILY_PLACE,
  dailyTimezone: process.env.DAILY_TIMEZONE ?? "America/Chicago",
  dailyHour: Number.isInteger(Number(process.env.DAILY_HOUR ?? 7)) ? Number(process.env.DAILY_HOUR ?? 7) : 7,
  dailyCaption: process.env.DAILY_CAPTION
} as const;
