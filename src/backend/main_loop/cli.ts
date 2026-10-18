import { runDailyPost } from "./job.js";
import { scheduleDaily } from "./schedule.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run daily                 Post every day at DAILY_HOUR
       npm run daily -- --now [--dry-run]   Post once now and exit (--dry-run skips Instagram)`);
  process.exit(0);
}

if (args.includes("--now")) {
  runDailyPost({ dryRun }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  scheduleDaily(() => runDailyPost({ dryRun }));
}
