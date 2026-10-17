import { config } from "../../config.js";
import type { Place } from "../sources/types.js";

const TIMEOUT_MS = 90_000;

export interface DailyCardOptions {
  /** "on" or "off" to force the school-day layout; leave unset for the website to decide from the date. */
  school?: string;
  /** Asks for the scrolling variant of the card. */
  scroll?: boolean;
}

/** Fetches the morning card PNG (1080×1350) from the website's /automation/daily route, authenticated with the bot's key. */
export const fetchDailyCard = async (place: Place, options: DailyCardOptions = {}): Promise<Buffer> => {
  if (!config.automationApiKey) throw new Error("Set AUTOMATION_API_KEY in .env to the website's automation key.");

  const url = new URL("/automation/daily", config.websiteUrl);
  url.searchParams.set("location", `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`);
  if (options.school) url.searchParams.set("school", options.school);
  if (options.scroll) url.searchParams.set("scroll", "on");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.automationApiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(`${url.pathname} returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
};
