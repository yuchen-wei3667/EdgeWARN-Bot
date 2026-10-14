export type Sky = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "thunder";

export interface HourSample {
  /** Local hour of day, 0-23. */
  hour: number;
  temperature: number;
  precipChance: number;
}

export interface DayPeriod {
  name: "Morning" | "Afternoon" | "Evening";
  /** Hours covered, such as "6 AM to 12 PM". */
  span: string;
  icon: string;
  condition: string;
  low: number;
  high: number;
  precipChance: number;
}

export interface DayStats {
  high: number;
  highHour: number;
  low: number;
  lowHour: number;
  precipChance: number;
  /** Compass abbreviation, such as "SSW". */
  windDirection: string;
  windSpeed: number;
  gust: number;
}

export interface DailyForecast {
  place: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** "Tomorrow" when too little of today is left to chart. */
  dayName: "Today" | "Tomorrow";
  /** Long local date, such as "Wednesday, October 14". */
  dateLabel: string;
  timezone: string;
  /** Sentence that opens the graphic. */
  headline: string;
  /** One or two sentences that back up the headline. */
  detail: string;
  sky: Sky;
  /** Hours shown on the chart, such as "6 AM to 10 PM". Starts later when the day is already under way. */
  windowLabel: string;
  /** Hourly samples across that window. */
  hours: HourSample[];
  peakIndex: number;
  periods: DayPeriod[];
  stats: DayStats;
  /** Set when the day carries a severe storm, flood, heat, or winter risk. */
  hazard?: Hazard;
  /** True for made-up data used to preview designs. */
  sample?: boolean;
  /** Short note on when the image was made, such as "Made Oct 14, 6:00 AM CDT". */
  madeLabel: string;
}

export type HazardKind = "severe" | "flood" | "heat" | "winter";
export type HazardLevel = "Elevated" | "High" | "Extreme";

/** A weather risk worth calling out, worked out from the hourly forecast. It is not an official NWS warning. */
export interface Hazard {
  kind: HazardKind;
  level: HazardLevel;
  /** Badge text, such as "Severe storm risk". */
  label: string;
  headline: string;
  detail: string;
  sky: Sky;
  /** Replaces the "Chance of rain" tile with the figure that matters for this hazard. */
  stat: { label: string; value: string; note: string };
}
