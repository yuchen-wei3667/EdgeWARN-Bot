export interface Place {
  /** Display name, such as "Oklahoma City, OK". Filled in from the NWS when missing. */
  label?: string;
  latitude: number;
  longitude: number;
}

export interface HourlyPoint {
  /** Local time, YYYY-MM-DDTHH:mm. */
  time: string;
  temperature: number;
  precipChance: number;
  /** NWS short forecast text, such as "Mostly Sunny". */
  shortForecast: string;
  isDaytime: boolean;
  /** Sustained wind in mph. When the NWS gives a range, the top of the range. */
  windSpeed: number;
  /** Compass abbreviation, such as "SSW". */
  windDirection: string;
  /** Gust in mph, never lower than the sustained wind. */
  gust: number;
  /** Relative humidity, 0-100. */
  humidity: number;
  /** Liquid precipitation expected in this hour, in inches. */
  rainIn: number;
  /** Snowfall expected in this hour, in inches. */
  snowIn: number;
}

export interface NwsForecast {
  timezone: string;
  /** "City, ST" of the NWS grid point's nearest town. */
  locationLabel: string;
  hourly: HourlyPoint[];
}
