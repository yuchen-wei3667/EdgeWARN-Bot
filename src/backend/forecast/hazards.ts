import type { HourlyPoint } from "../sources/types.js";
import { formatHour, hourOf } from "./summarize.js";
import type { Hazard, HazardKind, HazardLevel } from "./types.js";

const LEVELS: HazardLevel[] = ["Elevated", "High", "Extreme"];
/** When two hazards tie on level, the one earlier in this list wins. */
const PRIORITY: HazardKind[] = ["severe", "flood", "winter", "heat"];

const STORM_CHANCE = 30;
const WET_HOUR_IN = 0.05;

/** Index of the highest threshold the value reaches, or -1 when it reaches none. */
const levelFor = (value: number, thresholds: [number, number, number]): number =>
  thresholds.reduce((level, threshold, i) => (value >= threshold ? i : level), -1);

/** Heat index in °F from the NWS Rothfusz regression, which only applies once it is warm and humid. */
export const heatIndex = (temperature: number, humidity: number): number => {
  const T = temperature;
  const R = humidity;
  const simple = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((simple + T) / 2 < 80) return T;

  let hi =
    -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R +
    0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
  if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  return hi;
};

const span = (hours: HourlyPoint[]): string =>
  `${formatHour(hourOf(hours[0].time))} to ${formatHour((hourOf(hours[hours.length - 1].time) + 1) % 24)}`;

const peakBy = (hours: HourlyPoint[], value: (hour: HourlyPoint) => number): HourlyPoint =>
  hours.reduce((best, hour) => (value(hour) > value(best) ? hour : best), hours[0]);

const detectSevere = (window: HourlyPoint[]): { level: number; hazard: Hazard } | null => {
  const storms = window.filter((p) => /thunder/i.test(p.shortForecast) && p.precipChance >= STORM_CHANCE);
  if (!storms.length) return null;
  const windiest = peakBy(storms, (p) => p.gust);
  const level = levelFor(windiest.gust, [40, 58, 75]);
  if (level < 0) return null;

  const start = formatHour(hourOf(storms[0].time));
  const headline = [
    `Storms arrive around ${start}. Gusts may top ${windiest.gust}\u00A0mph.`,
    `Damaging storm winds possible around ${start}.`,
    `Destructive storm winds possible around ${start}.`
  ][level];
  return {
    level,
    hazard: {
      kind: "severe",
      level: LEVELS[level],
      label: "Severe storm risk",
      headline,
      detail: `Storms likely from ${span(storms)}, with gusts up to ${windiest.gust}\u00A0mph. Get indoors, away from windows, before they arrive.`,
      sky: "thunder",
      stat: { label: "Peak gust", value: `${windiest.gust}`, note: `mph around ${formatHour(hourOf(windiest.time))}` }
    }
  };
};

const detectFlood = (window: HourlyPoint[]): { level: number; hazard: Hazard } | null => {
  const total = window.reduce((sum, p) => sum + p.rainIn, 0);
  const wettest = peakBy(window, (p) => p.rainIn);
  const level = Math.max(levelFor(total, [1, 2, 3]), levelFor(wettest.rainIn, [0.4, 0.75, 1.25]));
  if (level < 0) return null;

  const wet = window.filter((p) => p.rainIn >= WET_HOUR_IN);
  const headline = ["Heavy rain may cause flooding.", "Flash flooding is possible.", "Significant flooding is possible."][level];
  return {
    level,
    hazard: {
      kind: "flood",
      level: LEVELS[level],
      label: "Flood risk",
      headline,
      detail: `About ${total.toFixed(1)}\u00A0inches of rain from ${span(wet.length ? wet : window)}, up to ${wettest.rainIn.toFixed(1)}\u00A0in an hour. Never drive through flooded roads.`,
      sky: "rain",
      stat: { label: "Rain total", value: `${total.toFixed(1)}"`, note: `up to ${wettest.rainIn.toFixed(1)} in/hr` }
    }
  };
};

const detectHeat = (window: HourlyPoint[]): { level: number; hazard: Hazard } | null => {
  const hottest = peakBy(window, (p) => heatIndex(p.temperature, p.humidity));
  const index = Math.round(heatIndex(hottest.temperature, hottest.humidity));
  const level = levelFor(index, [100, 105, 110]);
  if (level < 0) return null;

  const headline = [
    `Very hot. It feels like ${index}.`,
    `Dangerous heat. It feels like ${index}.`,
    `Extreme heat. It feels like ${index}.`
  ][level];
  const when = formatHour(hourOf(hottest.time));
  return {
    level,
    hazard: {
      kind: "heat",
      level: LEVELS[level],
      label: "Heat risk",
      headline,
      detail: `Heat index peaks at ${index} around ${when}. Drink water, limit time outdoors, and check on others.`,
      sky: "clear",
      stat: { label: "Heat index", value: `${index}°`, note: `around ${when}` }
    }
  };
};

const detectWinter = (window: HourlyPoint[]): { level: number; hazard: Hazard } | null => {
  const blizzard = window.some((p) => /blizzard/i.test(p.shortForecast));
  const icy = window.filter((p) => /freezing rain|freezing drizzle|ice|sleet/i.test(p.shortForecast) && p.precipChance >= STORM_CHANCE);
  const snowy = window.filter((p) => p.snowIn >= WET_HOUR_IN);
  const total = window.reduce((sum, p) => sum + p.snowIn, 0);
  const level = blizzard ? 2 : Math.max(levelFor(total, [1, 4, 8]), icy.length ? 1 : -1);
  if (level < 0) return null;

  const inches = Math.max(1, Math.round(total));
  const affected = icy.length && !blizzard ? icy : snowy.length ? snowy : window;
  const temp = Math.round(affected.reduce((sum, p) => sum + p.temperature, 0) / affected.length);
  const windiest = peakBy(window, (p) => p.gust);
  const lastHour = formatHour((hourOf(affected[affected.length - 1].time) + 1) % 24);

  if (blizzard) {
    return {
      level,
      hazard: {
        kind: "winter",
        level: LEVELS[level],
        label: "Winter storm risk",
        headline: "Blizzard conditions expected.",
        detail: `Heavy snow and gusts to ${windiest.gust}\u00A0mph cut visibility to near zero. Avoid travel if you can.`,
        sky: "snow",
        stat: { label: "Snowfall", value: `${inches}"`, note: `through ${lastHour}` }
      }
    };
  }
  if (icy.length && total < 1) {
    return {
      level,
      hazard: {
        kind: "winter",
        level: LEVELS[level],
        label: "Ice risk",
        headline: "Ice makes travel dangerous.",
        detail: `Freezing rain from ${span(icy)} with temperatures near ${temp}°. Expect icy roads and falling branches.`,
        sky: "snow",
        stat: { label: "Chance of ice", value: `${Math.round(Math.max(...icy.map((p) => p.precipChance)))}%`, note: "freezing rain" }
      }
    };
  }
  const headline = [`Snow likely, about ${inches}\u00A0inches.`, `Heavy snow, about ${inches}\u00A0inches.`, `Major snowstorm, about ${inches}\u00A0inches.`][level];
  return {
    level,
    hazard: {
      kind: "winter",
      level: LEVELS[level],
      label: "Winter storm risk",
      headline,
      detail: `Snow from ${span(affected)} with temperatures near ${temp}°. Roads may turn slick, so allow extra time.`,
      sky: "snow",
      stat: { label: "Snowfall", value: `${inches}"`, note: `through ${lastHour}` }
    }
  };
};

/** The most serious hazard in the day's hours, or null when nothing stands out. */
export const detectHazard = (window: HourlyPoint[]): Hazard | null => {
  const found = [detectSevere(window), detectFlood(window), detectWinter(window), detectHeat(window)].filter(
    (item): item is { level: number; hazard: Hazard } => item !== null
  );
  if (!found.length) return null;
  found.sort((a, b) => b.level - a.level || PRIORITY.indexOf(a.hazard.kind) - PRIORITY.indexOf(b.hazard.kind));
  return found[0].hazard;
};
