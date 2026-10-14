import type { HourlyPoint, NwsForecast } from "./types.js";

const KMH_TO_MPH = 0.621371;
const MM_TO_IN = 1 / 25.4;
const MAX_ATTEMPTS = 3;

interface PointsResponse {
  properties: {
    forecastHourly: string;
    forecastGridData: string;
    timeZone: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}

interface HourlyResponse {
  properties: {
    periods: Array<{
      startTime: string;
      temperature: number;
      isDaytime: boolean;
      probabilityOfPrecipitation?: { value: number | null };
      relativeHumidity?: { value: number | null };
      windSpeed: string;
      windDirection: string;
      shortForecast: string;
    }>;
  };
}

interface GridSeries {
  values: Array<{ validTime: string; value: number | null }>;
}

interface GridResponse {
  properties: {
    windGust?: GridSeries;
    quantitativePrecipitation?: GridSeries;
    snowfallAmount?: GridSeries;
  };
}

/** "5 to 10 mph" becomes 10, "14 mph" becomes 14. */
export const parseWindSpeed = (value: string): number => {
  const numbers = value.match(/\d+/g)?.map(Number) ?? [0];
  return Math.max(...numbers);
};

/**
 * Expands NWS grid values such as "2026-10-13T19:00:00+00:00/PT5H" into one entry per hour.
 * Amounts (rain, snow) cover the whole span, so they are split evenly across its hours; rates (gusts) repeat.
 */
const seriesByHour = (values: GridSeries["values"], kind: "rate" | "amount"): Map<number, number> => {
  const byHour = new Map<number, number>();
  for (const { validTime, value } of values) {
    if (value === null) continue;
    const [start, duration] = validTime.split("/");
    const days = Number(duration.match(/(\d+)D/)?.[1] ?? 0);
    const hours = Number(duration.match(/(\d+)H/)?.[1] ?? 0) + days * 24;
    const startMs = Date.parse(start);
    for (let h = 0; h < hours; h += 1) {
      byHour.set(startMs + h * 3_600_000, kind === "amount" ? value / hours : value);
    }
  }
  return byHour;
};

export class NwsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string
  ) {}

  private async getJson<T>(url: string | URL, what: string): Promise<T> {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(url, {
        headers: { "User-Agent": this.userAgent, Accept: "application/geo+json" }
      });

      if (response.ok) {
        return (await response.json()) as T;
      }
      if (response.status === 404) {
        throw new Error(`The NWS has no ${what} for this location. It only covers the United States and its territories.`);
      }

      lastError = `${response.status} ${response.statusText}`;
      // The NWS API returns occasional 5xx errors that clear on retry.
      if (response.status < 500 || attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }

    throw new Error(`Failed to fetch ${what} from the NWS: ${lastError}`);
  }

  /** Fetches the hourly forecast for a point, with gusts from the raw grid data. */
  async getForecast(latitude: number, longitude: number): Promise<NwsForecast> {
    const point = await this.getJson<PointsResponse>(
      new URL(`/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`, this.baseUrl),
      "forecast point"
    );
    const { forecastHourly, forecastGridData, timeZone, relativeLocation } = point.properties;

    const [hourly, grid] = await Promise.all([
      this.getJson<HourlyResponse>(`${forecastHourly}?units=us`, "hourly forecast"),
      this.getJson<GridResponse>(forecastGridData, "forecast grid")
    ]);
    const gusts = seriesByHour(grid.properties.windGust?.values ?? [], "rate");
    const rain = seriesByHour(grid.properties.quantitativePrecipitation?.values ?? [], "amount");
    const snow = seriesByHour(grid.properties.snowfallAmount?.values ?? [], "amount");

    const town = relativeLocation?.properties;
    return {
      timezone: timeZone,
      locationLabel: town?.city && town.state ? `${town.city}, ${town.state}` : `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      hourly: hourly.properties.periods.map((period): HourlyPoint => {
        const windSpeed = parseWindSpeed(period.windSpeed);
        return {
          // The NWS start time carries the local offset, so its first 16 characters are local time.
          time: period.startTime.slice(0, 16),
          temperature: period.temperature,
          precipChance: period.probabilityOfPrecipitation?.value ?? 0,
          shortForecast: period.shortForecast,
          isDaytime: period.isDaytime,
          windSpeed,
          windDirection: period.windDirection,
          gust: Math.max(windSpeed, Math.round((gusts.get(Date.parse(period.startTime)) ?? 0) * KMH_TO_MPH)),
          humidity: period.relativeHumidity?.value ?? 50,
          rainIn: (rain.get(Date.parse(period.startTime)) ?? 0) * MM_TO_IN,
          snowIn: (snow.get(Date.parse(period.startTime)) ?? 0) * MM_TO_IN
        };
      })
    };
  }
}
