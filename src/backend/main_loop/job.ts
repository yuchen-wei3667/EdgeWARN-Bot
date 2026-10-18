import { config } from "../../config.js";
import { publishImage } from "../../connectors/ig/index.js";
import { dailyCardUrl } from "../forecast/automation.js";
import { resolvePlace } from "../forecast/index.js";
import { GeocodingClient } from "../sources/geocoding.js";

export interface DailyJobOptions {
  /** Prints the card URL and caption but skips publishing to Instagram. */
  dryRun?: boolean;
}

const defaultCaption = (label: string): string => {
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: config.dailyTimezone }).format(new Date());
  return `${label} forecast for ${date} #weather`;
};

/** Posts today's forecast card to the Instagram feed. Instagram downloads it straight from the website's public /automation/daily route. */
export const runDailyPost = async (options: DailyJobOptions = {}): Promise<void> => {
  if (!config.dailyPlace) throw new Error("Set DAILY_PLACE in .env, such as DAILY_PLACE=Oklahoma City, OK.");

  const place = await resolvePlace({ geocoding: new GeocodingClient(config.geocodingApi) }, { place: config.dailyPlace });
  const imageUrl = dailyCardUrl(place).href;
  const caption = config.dailyCaption || defaultCaption(place.label ?? config.dailyPlace);

  if (options.dryRun) {
    console.log(`Dry run: would post ${imageUrl}\nCaption: ${caption}`);
    return;
  }
  // Not retried: a retry after a timeout could post the same image twice.
  const result = await publishImage("feed", imageUrl, caption);
  console.log(`Published ${result.kind}: ${result.mediaId}${result.permalink ? ` ${result.permalink}` : ""}`);
};
