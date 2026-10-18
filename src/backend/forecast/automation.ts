import { config } from "../../config.js";
import type { Place } from "../sources/types.js";
import { schoolOverride } from "./school.js";

const TIMEOUT_MS = 90_000;

export interface DailyCardOptions {
  /** "on" or "off" to force the school-day layout; leave unset to use "off" on weekends and configured closures, otherwise the website decides. */
  school?: string;
  /** Asks for the scrolling variant of the card. */
  scroll?: boolean;
  /** Uses the story-sized card from /automation/daily/story instead of the feed card. */
  story?: boolean;
}

/** The public URL of the morning card (1080×1350 JPEG) from the website's /automation/daily route. */
export const dailyCardUrl = (place: Place, options: DailyCardOptions = {}): URL => {
  const url = new URL(options.story ? "/automation/daily/story" : "/automation/daily", config.websiteUrl);
  url.searchParams.set("location", `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`);
  const school = options.school ?? schoolOverride();
  if (school) url.searchParams.set("school", school);
  if (options.scroll) url.searchParams.set("scroll", "on");
  return url;
};

/** Downloads the morning card from the website's /automation/daily route. */
export const fetchDailyCard = async (place: Place, options: DailyCardOptions = {}): Promise<Buffer> => {
  const url = dailyCardUrl(place, options);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(`${url.pathname} returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
};
