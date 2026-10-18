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

/** Posts today's forecast card to the Instagram feed and the story. Instagram downloads it straight from the website's public /automation/daily route. */
export const runDailyPost = async (options: DailyJobOptions = {}): Promise<void> => {
  if (!config.dailyPlace) throw new Error("Set DAILY_PLACE in .env, such as DAILY_PLACE=Oklahoma City, OK.");

  const place = await resolvePlace({ geocoding: new GeocodingClient(config.geocodingApi) }, { place: config.dailyPlace });
  const imageUrl = dailyCardUrl(place).href;
  const storyUrl = dailyCardUrl(place, { story: true }).href;
  const caption = config.dailyCaption || defaultCaption(place.label ?? config.dailyPlace);

  if (options.dryRun) {
    console.log(`Dry run: would post ${imageUrl}\nCaption: ${caption}\nStory: ${storyUrl}`);
    return;
  }
  // Not retried: a retry after a timeout could post the same image twice. The feed post and story are independent, so one failing does not skip the other.
  const posts = [
    { name: "feed", publish: () => publishImage("feed", imageUrl, caption) },
    { name: "story", publish: () => publishImage("story", storyUrl) }
  ];
  const failures: string[] = [];
  for (const post of posts) {
    try {
      const result = await post.publish();
      console.log(`Published ${result.kind}: ${result.mediaId}${result.permalink ? ` ${result.permalink}` : ""}`);
    } catch (error) {
      failures.push(`${post.name}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) throw new Error(`Instagram post failed (${failures.join("; ")})`);
};
