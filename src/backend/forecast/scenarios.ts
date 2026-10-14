import type { HourlyPoint, NwsForecast } from "../sources/types.js";
import { buildDailyForecast } from "./generate.js";
import type { DailyForecast } from "./types.js";

export interface Scenario {
  id: string;
  forecast: DailyForecast;
}

const DATE = "2026-10-14";
/** Late on the date in UTC, so every U.S. time zone is still on 2026-10-14. */
const NOW = new Date(`${DATE}T16:00:00Z`);

interface Spec {
  id: string;
  place: string;
  timezone: string;
  /** Temperature by local hour, from a low at dawn to a high mid-afternoon. */
  low: number;
  high: number;
  humidity?: number;
  wind?: number;
  /** Hours (inclusive) that carry the weather, and what it looks like. */
  wet?: { from: number; to: number; text: string; chance: number; rainIn?: number; snowIn?: number; gust?: number; peakHour?: number };
  dry?: string;
}

/** A smooth day: coolest at 6 AM, warmest at 3 PM. */
const temperatureAt = (hour: number, low: number, high: number): number => {
  const phase = Math.cos(((hour - 15) / 24) * 2 * Math.PI);
  const range = Math.cos((9 / 24) * 2 * Math.PI);
  return low + ((phase - range) / (1 - range)) * (high - low);
};

const build = (spec: Spec): Scenario => {
  const hourly: HourlyPoint[] = [];
  for (let hour = 6; hour <= 22; hour += 1) {
    const wet = spec.wet && hour >= spec.wet.from && hour <= spec.wet.to ? spec.wet : undefined;
    // Weather peaks mid-spell: rain and gusts taper toward the edges.
    const middle = wet ? (wet.peakHour ?? (wet.from + wet.to) / 2) : 0;
    const reach = wet ? Math.max(1, (wet.to - wet.from) / 2) : 1;
    const weight = wet ? Math.max(0.35, 1 - Math.abs(hour - middle) / (reach + 1)) : 0;
    const windSpeed = spec.wind ?? 8;
    hourly.push({
      time: `${DATE}T${String(hour).padStart(2, "0")}:00`,
      temperature: Math.round(temperatureAt(hour, spec.low, spec.high)),
      precipChance: wet ? Math.round(wet.chance * (0.6 + 0.4 * weight)) : 5,
      shortForecast: wet ? wet.text : (spec.dry ?? "Mostly Sunny"),
      isDaytime: hour >= 7 && hour <= 19,
      windSpeed,
      windDirection: "S",
      gust: Math.round(wet?.gust ? windSpeed + (wet.gust - windSpeed) * weight ** 2 : windSpeed + 4),
      humidity: spec.humidity ?? 55,
      rainIn: (wet?.rainIn ?? 0) * weight,
      snowIn: (wet?.snowIn ?? 0) * weight
    });
  }
  const forecast: NwsForecast = { timezone: spec.timezone, locationLabel: spec.place, hourly };
  const built = buildDailyForecast(forecast, { label: spec.place, latitude: 0, longitude: 0 }, NOW);
  return { id: spec.id, forecast: { ...built, sample: true, madeLabel: "Sample" } };
};

const OKC = { place: "Oklahoma City, OK", timezone: "America/Chicago" };
const HOU = { place: "Houston, TX", timezone: "America/Chicago" };
const PHX = { place: "Phoenix, AZ", timezone: "America/Phoenix" };
const BUF = { place: "Buffalo, NY", timezone: "America/New_York" };

/** Made-up days that each trip one hazard at one level, for previewing the designs. */
export const buildScenarios = (): Scenario[] =>
  [
    { id: "severe-elevated", ...OKC, low: 66, high: 84, wind: 12, wet: { from: 16, to: 20, text: "Showers And Thunderstorms Likely", chance: 70, gust: 46, peakHour: 18 } },
    { id: "severe-high", ...OKC, low: 70, high: 88, humidity: 65, wind: 16, wet: { from: 17, to: 21, text: "Showers And Thunderstorms", chance: 90, gust: 64, peakHour: 19 } },
    { id: "flood-elevated", ...HOU, low: 68, high: 77, humidity: 85, wind: 9, wet: { from: 10, to: 19, text: "Rain", chance: 85, rainIn: 0.3, peakHour: 15 } },
    { id: "flood-extreme", ...HOU, low: 69, high: 75, humidity: 92, wind: 14, wet: { from: 6, to: 22, text: "Showers And Thunderstorms", chance: 98, rainIn: 0.55, gust: 28, peakHour: 14 } },
    { id: "heat-elevated", ...PHX, low: 74, high: 97, humidity: 38, wind: 7 },
    { id: "heat-extreme", ...PHX, low: 86, high: 110, humidity: 20, wind: 6 },
    { id: "winter-snow", ...BUF, low: 24, high: 30, humidity: 85, wind: 14, wet: { from: 7, to: 18, text: "Snow", chance: 95, snowIn: 0.75, gust: 26, peakHour: 12 } },
    { id: "winter-ice", ...BUF, low: 28, high: 32, humidity: 90, wind: 8, wet: { from: 8, to: 20, text: "Freezing Rain", chance: 80, rainIn: 0.06, peakHour: 14 } },
    { id: "winter-blizzard", ...BUF, low: 12, high: 20, humidity: 80, wind: 28, wet: { from: 6, to: 21, text: "Blizzard", chance: 95, snowIn: 0.8, gust: 52, peakHour: 13 } }
  ].map(build);
