import { config } from "../../config.js";

const partsIn = (date: Date, timeZone: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
};

/** Milliseconds from `now` until the next `minutes` after midnight (wall-clock) in `timeZone`. Recomputed each run, so DST shifts are handled. */
export const msUntilNext = (minutes: number, timeZone: string, now = new Date()): number => {
  const local = partsIn(now, timeZone);
  const sinceMidnight = (local.hour * 60 + local.minute) * 60_000 + local.second * 1000 + now.getMilliseconds();
  let wait = minutes * 60_000 - sinceMidnight;
  if (wait <= 0) wait += 86_400_000;
  return wait;
};

const formatTime = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Runs `job` every day at `minutes` after midnight in config.dailyTimezone. A missed run is skipped, and runs never overlap. */
export const scheduleDaily = (name: string, minutes: number, job: () => Promise<void>): void => {
  let running = false;
  const arm = (): void => {
    const wait = msUntilNext(minutes, config.dailyTimezone);
    console.log(`Next daily ${name} at ${new Date(Date.now() + wait).toISOString()} (${formatTime(minutes)} ${config.dailyTimezone}).`);
    setTimeout(() => {
      if (running) return arm();
      running = true;
      job()
        .catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          running = false;
          arm();
        });
    }, wait);
  };
  arm();
};
