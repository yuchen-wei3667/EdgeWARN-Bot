import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Parses "HH:MM" into minutes after midnight, or returns the fallback. */
const toMinutes = (value: string | undefined, fallback: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "") ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 1440 ? minutes : toMinutes(undefined, fallback);
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
  dailyTimezone: process.env.DAILY_TIMEZONE ?? "America/New_York",
  // Minutes after midnight in dailyTimezone: the feed post at 6:20 AM and the story at 6:50 AM.
  dailyFeedMinutes: toMinutes(process.env.DAILY_FEED_TIME, "06:20"),
  dailyStoryMinutes: toMinutes(process.env.DAILY_STORY_TIME, "06:50"),
  dailyCaption: process.env.DAILY_CAPTION,
  // "plain" drops the questions and sharing prompts from generated captions, as a baseline for comparing post insights.
  captionStyle: process.env.CAPTION_STYLE === "plain" ? ("plain" as const) : ("auto" as const),
  // JSON list of {date, reason} school closures; the card uses school=off on these dates and weekends.
  schoolClosuresFile: path.resolve(process.cwd(), process.env.SCHOOL_CLOSURES_FILE ?? "config/school-closures.json")
} as const;
