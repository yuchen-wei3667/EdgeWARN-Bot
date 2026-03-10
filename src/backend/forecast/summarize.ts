import type { HourlyPoint } from "../sources/types.js";
import { describeSignificant } from "./conditions.js";
import type { Sky } from "./types.js";

const FULL_COMPASS: Record<string, string> = {
  N: "North", NNE: "North-northeast", NE: "Northeast", ENE: "East-northeast", E: "East", ESE: "East-southeast",
  SE: "Southeast", SSE: "South-southeast", S: "South", SSW: "South-southwest", SW: "Southwest", WSW: "West-southwest",
  W: "West", WNW: "West-northwest", NW: "Northwest", NNW: "North-northwest"
};

export const formatHour = (hour: number): string => `${hour % 12 || 12}\u00A0${hour < 12 ? "AM" : "PM"}`;

export const hourOf = (time: string): number => Number(time.slice(11, 13));

const temperatureWord = (high: number): string => {
  if (high <= 32) return "Freezing";
  if (high < 50) return "Cold";
  if (high < 65) return "Cool";
  if (high < 78) return "Mild";
  if (high < 90) return "Warm";
  return "Hot";
};

const skyPhrase: Record<Sky, string> = {
  clear: "sunny",
  partly: "partly cloudy",
  cloud: "overcast",
  fog: "foggy",
  rain: "wet",
  snow: "snowy",
  thunder: "stormy"
};

const WET_HOUR_CHANCE = 50;
const STORM_CHANCE = 30;
const BREEZY_GUST_MPH = 25;
const DAY_START = 6;
const DAY_END = 22;
/** Fewer remaining hours than this and a "today" graphic has too little to show. */
export const MIN_HOURS = 4;

/** The hours a day is judged on: 6 AM to 10 PM, limited to hours the NWS still lists. */
export const dayWindow = (hourly: HourlyPoint[], date: string): HourlyPoint[] =>
  hourly.filter((p) => p.time.startsWith(date) && hourOf(p.time) >= DAY_START && hourOf(p.time) <= DAY_END);

export interface Summary {
  headline: string;
  detail: string;
  sky: Sky;
}

/** Writes the headline and supporting sentences for the hours in `window`. */
export const summarizeToday = (window: HourlyPoint[], day: "today" | "tomorrow"): Summary => {
  const high = window.reduce((best, p) => (p.temperature > best.temperature ? p : best), window[0]);
  const windiest = window.reduce((best, p) => (p.gust > best.gust ? p : best), window[0]);
  const condition = describeSignificant(window);

  const stormHour = window.find((p) => /thunder/i.test(p.shortForecast) && p.precipChance >= STORM_CHANCE);
  const wetHour = window.find((p) => p.precipChance >= WET_HOUR_CHANCE);
  const rainsFromTheStart = wetHour && wetHour === window[0];
  const noun = condition.sky === "snow" ? "Snow" : "Rain";

  let headline: string;
  let sky = condition.sky;
  if (stormHour) {
    headline = `Storms arrive around ${formatHour(hourOf(stormHour.time))}. Some may be severe.`;
    sky = "thunder";
  } else if (wetHour) {
    headline = rainsFromTheStart ? `${noun} most of the day.` : `${noun} arrives around ${formatHour(hourOf(wetHour.time))}.`;
    sky = condition.sky === "snow" ? "snow" : "rain";
  } else {
    headline = `${temperatureWord(high.temperature)} and ${skyPhrase[condition.sky === "rain" ? "partly" : condition.sky]}`;
    headline += windiest.gust >= BREEZY_GUST_MPH ? ", with gusty winds this afternoon." : ".";
  }

  const direction = FULL_COMPASS[windiest.windDirection] ?? windiest.windDirection;
  const wind =
    windiest.gust > windiest.windSpeed
      ? `${direction} winds gust to ${windiest.gust} mph.`
      : `${direction} winds reach ${windiest.windSpeed} mph.`;
  const detail = `Highs reach ${Math.round(high.temperature)} around ${formatHour(hourOf(high.time))}. ${wind} ${
    stormHour || wetHour ? "Plan outdoor time around the wet hours." : `Rain stays away ${day}.`
  }`;

  return { headline, detail, sky };
};
