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

/** Milliseconds from `now` until the next `hour`:00 wall-clock time in `timeZone`. Recomputed each run, so DST shifts are handled. */
export const msUntilNext = (hour: number, timeZone: string, now = new Date()): number => {
  const local = partsIn(now, timeZone);
  const sinceMidnight = (local.hour * 60 + local.minute) * 60_000 + local.second * 1000 + now.getMilliseconds();
  let wait = hour * 3_600_000 - sinceMidnight;
  if (wait <= 0) wait += 86_400_000;
  return wait;
};

/** Runs `job` every day at config.dailyHour in config.dailyTimezone. A missed run is skipped, and runs never overlap. */
export const scheduleDaily = (job: () => Promise<void>): void => {
  let running = false;
  const arm = (): void => {
    const wait = msUntilNext(config.dailyHour, config.dailyTimezone);
    console.log(`Next daily post at ${new Date(Date.now() + wait).toISOString()} (${config.dailyHour}:00 ${config.dailyTimezone}).`);
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
