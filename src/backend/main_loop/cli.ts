import { config } from "../../config.js";
import { runDailyPost } from "./job.js";
import { scheduleDaily } from "./schedule.js";

// A downstream command may close a pipe (for example, when used with `head`).
// Stop logging to the closed pipe while allowing scheduled work to finish.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    console.log = () => {};
    return;
  }
  throw error;
});

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run daily                 Post the feed card at DAILY_FEED_TIME and the story at DAILY_STORY_TIME
       npm run daily -- --now [--dry-run]   Post once now and exit (--dry-run skips Instagram)`);
  process.exit(0);
}

if (args.includes("--now")) {
  runDailyPost({ dryRun }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  scheduleDaily("feed post", config.dailyFeedMinutes, () => runDailyPost({ dryRun, kind: "feed" }));
  scheduleDaily("story", config.dailyStoryMinutes, () => runDailyPost({ dryRun, kind: "story" }));
}
