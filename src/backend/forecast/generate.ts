import { NwsClient } from "../sources/nws.js";
import type { HourlyPoint, NwsForecast, Place } from "../sources/types.js";
import { describeHour, describeSignificant } from "./conditions.js";
import { detectHazard } from "./hazards.js";
import { MIN_HOURS, dayWindow, formatHour, hourOf, summarizeToday } from "./summarize.js";
import type { DailyForecast, DayPeriod } from "./types.js";

const PERIODS: Array<{ name: DayPeriod["name"]; from: number; to: number }> = [
  { name: "Morning", from: 6, to: 11 },
  { name: "Afternoon", from: 12, to: 17 },
  { name: "Evening", from: 18, to: 22 }
];

const dateKey = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

const longDate = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );

const spanOf = (hours: HourlyPoint[]): string =>
  `${formatHour(hourOf(hours[0].time))} to ${formatHour((hourOf(hours[hours.length - 1].time) + 1) % 24)}`;

const summarizePeriod = (name: DayPeriod["name"], hours: HourlyPoint[]): DayPeriod => {
  const temps = hours.map((p) => p.temperature);
  const condition = describeSignificant(hours);
  return {
    name,
    span: spanOf(hours),
    icon: condition.icon,
    condition: condition.label,
    low: Math.round(Math.min(...temps)),
    high: Math.round(Math.max(...temps)),
    precipChance: Math.round(Math.max(...hours.map((p) => p.precipChance)))
  };
};

/**
 * Builds the data behind one daily forecast graphic.
 * The NWS hourly feed starts at the current hour, so a late run shows the rest of today.
 * With fewer than four hours left, it shows tomorrow instead.
 */
export const generateDailyForecast = async (
  client: NwsClient,
  place: Place,
  now: Date = new Date()
): Promise<DailyForecast> =>
  buildDailyForecast(await client.getForecast(place.latitude, place.longitude), place, now);

/** The pure half of generateDailyForecast: turns an NWS forecast into graphic data. */
export const buildDailyForecast = (forecast: NwsForecast, place: Place, now: Date): DailyForecast => {
  const today = dateKey(now, forecast.timezone);
  const dates = [...new Set(forecast.hourly.map((p) => p.time.slice(0, 10)))].filter((d) => d >= today);
  const date = dates.find((d) => dayWindow(forecast.hourly, d).length >= MIN_HOURS);
  if (!date) {
    throw new Error("The NWS returned too few hours to build a daily forecast.");
  }

  const window = dayWindow(forecast.hourly, date);
  const dayName = date === today ? "Today" : "Tomorrow";
  const base = summarizeToday(window, dayName === "Today" ? "today" : "tomorrow");
  const hazard = detectHazard(window) ?? undefined;
  const summary = hazard ? { headline: hazard.headline, detail: hazard.detail, sky: hazard.sky } : base;
  const hours = window.map((p) => ({ hour: hourOf(p.time), temperature: p.temperature, precipChance: p.precipChance }));
  const indexOfBest = (better: (a: number, b: number) => boolean) =>
    hours.reduce((best, h, i) => (better(h.temperature, hours[best].temperature) ? i : best), 0);
  const peakIndex = indexOfBest((a, b) => a > b);
  const coolestIndex = indexOfBest((a, b) => a < b);
  const windiest = window.reduce((best, p) => (p.gust > best.gust ? p : best), window[0]);

  const made = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: forecast.timezone
  }).format(now);

  return {
    place: place.label ?? forecast.locationLabel,
    date,
    dayName,
    dateLabel: longDate(date),
    timezone: forecast.timezone,
    headline: summary.headline,
    detail: summary.detail,
    sky: summary.sky,
    hazard,
    windowLabel: `${formatHour(hourOf(window[0].time))} to ${formatHour(hourOf(window[window.length - 1].time))}`,
    hours,
    peakIndex,
    periods: PERIODS.map((p) =>
      window.filter((h) => hourOf(h.time) >= p.from && hourOf(h.time) <= p.to)
    )
      .map((hoursIn, i) => (hoursIn.length ? summarizePeriod(PERIODS[i].name, hoursIn) : null))
      .filter((p): p is DayPeriod => p !== null),
    stats: {
      high: Math.round(hours[peakIndex].temperature),
      highHour: hours[peakIndex].hour,
      low: Math.round(hours[coolestIndex].temperature),
      lowHour: hours[coolestIndex].hour,
      precipChance: Math.round(Math.max(...hours.map((h) => h.precipChance))),
      windDirection: windiest.windDirection,
      windSpeed: windiest.windSpeed,
      gust: windiest.gust
    },
    madeLabel: `Made ${made}`
  };
};
