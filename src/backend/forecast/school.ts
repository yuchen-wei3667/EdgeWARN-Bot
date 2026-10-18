import { readFileSync } from "node:fs";
import { config } from "../../config.js";

interface SchoolClosure {
  date: string;
  reason: string;
}

const loadClosures = (): Set<string> => {
  try {
    const closures = JSON.parse(readFileSync(config.schoolClosuresFile, "utf8")) as SchoolClosure[];
    return new Set(closures.map((closure) => closure.date));
  } catch (error) {
    console.warn(`Could not read school closures from ${config.schoolClosuresFile}: ${(error as Error).message}`);
    return new Set();
  }
};

const closureDates = loadClosures();

/** "off" on weekends and listed closure dates (in the daily timezone); undefined leaves the call to the website. */
export const schoolOverride = (now: Date = new Date()): "off" | undefined => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: config.dailyTimezone, weekday: "short" }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: config.dailyTimezone }).format(now);
  return weekday === "Sat" || weekday === "Sun" || closureDates.has(date) ? "off" : undefined;
};
