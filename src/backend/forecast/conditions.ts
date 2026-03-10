import type { HourlyPoint } from "../sources/types.js";
import type { Sky } from "./types.js";

export interface Condition {
  label: string;
  sky: Sky;
  icon: string;
}

const WET_SKIES: Sky[] = ["rain", "snow", "thunder"];
const SEVERITY: Record<Sky, number> = { clear: 0, partly: 1, cloud: 2, fog: 3, rain: 4, snow: 5, thunder: 6 };
/** Wet conditions only count once rain is reasonably likely. */
const MIN_WET_CHANCE = 30;

export const skyOf = (shortForecast: string): Sky => {
  const text = shortForecast.toLowerCase();
  if (text.includes("thunder")) return "thunder";
  if (/snow|flurr|sleet|blizzard|wintry|freezing/.test(text)) return "snow";
  if (/rain|shower|drizzle/.test(text)) return "rain";
  if (/fog|haze|smoke|mist|dust/.test(text)) return "fog";
  if (/partly|mostly cloudy|mostly sunny.*cloud/.test(text)) return text.includes("partly") ? "partly" : "cloud";
  if (/cloudy|overcast/.test(text)) return "cloud";
  if (/sunny|clear|fair/.test(text)) return "clear";
  return "cloud";
};

const sentenceCase = (value: string): string => {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** Picks an icon and a short label for one hour of NWS forecast text. */
export const describeHour = (hour: HourlyPoint): Condition => {
  const sky = skyOf(hour.shortForecast);
  const night = !hour.isDaytime;
  const icons: Record<Sky, string> = {
    clear: night ? "moon" : "sun",
    partly: night ? "cloud-moon" : "cloud-sun",
    cloud: "cloud",
    fog: "cloud-fog",
    rain: "cloud-rain",
    snow: "snowflake",
    thunder: "cloud-lightning"
  };
  // "Slight Chance Showers And Thunderstorms" is too long for a column; the chance figure already says it.
  const label = sky === "thunder" ? "Thunderstorms" : sentenceCase(hour.shortForecast.replace(/^(slight chance|chance|likely)\s+/i, ""));
  return { label, sky, icon: icons[sky] };
};

const rank = (hour: HourlyPoint): number => {
  const sky = skyOf(hour.shortForecast);
  return WET_SKIES.includes(sky) && hour.precipChance < MIN_WET_CHANCE ? SEVERITY.cloud : SEVERITY[sky];
};

/** The hour whose weather matters most: the wettest or stormiest, or the cloudiest when it stays dry. */
export const significantHour = (hours: HourlyPoint[]): HourlyPoint =>
  hours.reduce((best, hour) => (rank(hour) > rank(best) ? hour : best), hours[0]);

/** Like describeHour, but a wet forecast with a low chance of rain reads as cloudy. */
export const describeSignificant = (hours: HourlyPoint[]): Condition => {
  const worst = significantHour(hours);
  const condition = describeHour(worst);
  if (WET_SKIES.includes(condition.sky) && worst.precipChance < MIN_WET_CHANCE) {
    return { label: "Mostly cloudy", sky: "cloud", icon: "cloud" };
  }
  return condition;
};
