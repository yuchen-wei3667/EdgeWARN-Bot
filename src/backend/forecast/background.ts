import type { DailyForecast } from "./types.js";

/** Same categories the EdgeWARN website uses for its dynamic weather backgrounds. */
export type WeatherCategory =
  | "clear-day"
  | "partly-cloudy-day"
  | "cloud"
  | "fog"
  | "light-rain"
  | "rain"
  | "heavy-rain"
  | "freezing-rain"
  | "snow"
  | "thunder";

interface Palette {
  base: string;
  glow: string;
  cloud: string;
}

// Colors match the website's weather-atmosphere styles, flattened onto the image's dark page color.
const PALETTES: Record<WeatherCategory, Palette> = {
  "clear-day": { base: "rgb(54 118 158 / 0.55)", glow: "rgb(234 186 103 / 0.18)", cloud: "transparent" },
  "partly-cloudy-day": { base: "rgb(62 111 145 / 0.50)", glow: "rgb(222 181 113 / 0.18)", cloud: "rgb(181 194 205 / 0.30)" },
  cloud: { base: "rgb(81 102 122 / 0.48)", glow: "rgb(172 184 195 / 0.27)", cloud: "rgb(176 190 201 / 0.33)" },
  fog: { base: "rgb(77 99 114 / 0.43)", glow: "transparent", cloud: "rgb(166 181 191 / 0.32)" },
  "light-rain": { base: "rgb(45 68 91 / 0.60)", glow: "rgb(56 189 248 / 0.38)", cloud: "rgb(148 163 178 / 0.29)" },
  rain: { base: "rgb(35 58 80 / 0.65)", glow: "rgb(78 158 191 / 0.46)", cloud: "rgb(124 143 158 / 0.28)" },
  "heavy-rain": { base: "rgb(23 42 64 / 0.72)", glow: "rgb(14 165 233 / 0.50)", cloud: "rgb(100 125 145 / 0.30)" },
  "freezing-rain": { base: "rgb(38 65 88 / 0.65)", glow: "rgb(56 189 248 / 0.40)", cloud: "rgb(165 180 196 / 0.31)" },
  snow: { base: "rgb(78 118 144 / 0.48)", glow: "rgb(187 217 231 / 0.39)", cloud: "rgb(182 202 217 / 0.34)" },
  thunder: { base: "rgb(29 36 54 / 0.72)", glow: "rgb(104 139 187 / 0.40)", cloud: "rgb(106 123 145 / 0.29)" }
};

const RAIN_CATEGORIES: ReadonlySet<WeatherCategory> = new Set(["light-rain", "rain", "heavy-rain", "freezing-rain", "thunder"]);

export const categoryOf = (forecast: DailyForecast): WeatherCategory => {
  const { hazard } = forecast;
  if (hazard) {
    if (hazard.kind === "severe") return "thunder";
    if (hazard.kind === "flood") return "heavy-rain";
    if (hazard.kind === "heat") return "clear-day";
    return /ice|freezing/i.test(hazard.label) ? "freezing-rain" : "snow";
  }
  const peakChance = Math.max(...forecast.hours.map((h) => h.precipChance));
  switch (forecast.sky) {
    case "clear": return "clear-day";
    case "partly": return "partly-cloudy-day";
    case "cloud": return "cloud";
    case "fog": return "fog";
    case "snow": return "snow";
    case "thunder": return "thunder";
    case "rain": return peakChance < 50 ? "light-rain" : peakChance >= 85 ? "heavy-rain" : "rain";
  }
};

/** Stable per-forecast variation, so the same forecast always draws the same sky. */
const seededRandom = (seed: string): (() => number) => {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967295;
  };
};

const rgbToHex = (value: string): { color: string; opacity: number } => {
  const match = value.match(/rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)/);
  if (!match) return { color: "#000", opacity: 0 };
  return { color: `rgb(${match[1]},${match[2]},${match[3]})`, opacity: match[4] === undefined ? 1 : Number(match[4]) };
};

export interface Background {
  defs: string;
  body: string;
}

/**
 * Builds the image background in the style of the website's weather atmosphere:
 * a tinted base wash, blurred glow and cloud blobs, plus rain streaks or sun glows
 * when the weather calls for them.
 */
export const buildBackground = (forecast: DailyForecast, width: number, height: number, pageColor: string): Background => {
  const category = categoryOf(forecast);
  const palette = PALETTES[category];
  const random = seededRandom(`${forecast.place}-${forecast.date}-${category}`);
  const base = rgbToHex(palette.base);
  const glow = rgbToHex(palette.glow);
  const cloud = rgbToHex(palette.cloud);

  const blobs: string[] = [];
  const blob = (x: number, y: number, r: number, color: { color: string; opacity: number }, boost: number): void => {
    if (color.opacity === 0) return;
    // The website's glows sit on small cards; scaled up for a full-size post.
    blobs.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${color.color}" opacity="${Math.min(1, color.opacity * boost).toFixed(2)}"/>`);
  };
  const clear = category === "clear-day";
  for (let i = 0; i < 6; i += 1) {
    blob(random() * width, random() * height * 0.75, 260 + random() * 220, glow, clear ? 1.5 : 1.6);
  }
  for (let i = 0; i < 6; i += 1) {
    blob(random() * width, random() * height * 0.8, 240 + random() * 240, cloud, 1.5);
  }
  if (clear) {
    // Broad sunlight fields, like the website's sun glows.
    blobs.push(
      `<circle cx="${(width * 0.85).toFixed(0)}" cy="90" r="420" fill="rgb(255,222,145)" opacity="0.20"/>`,
      `<circle cx="${(width * 0.2).toFixed(0)}" cy="${(height * 0.45).toFixed(0)}" r="380" fill="rgb(241,190,111)" opacity="0.12"/>`
    );
  }

  const streaks: string[] = [];
  if (RAIN_CATEGORIES.has(category)) {
    const count = category === "light-rain" ? 40 : category === "heavy-rain" || category === "thunder" ? 130 : 85;
    const stroke = category === "freezing-rain" ? "rgb(200,230,255)" : "rgb(170,215,245)";
    for (let i = 0; i < count; i += 1) {
      const x = random() * (width + 200);
      const y = random() * height;
      const length = 30 + random() * 40;
      streaks.push(`<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - length * 0.2).toFixed(0)}" y2="${(y + length).toFixed(0)}" stroke="${stroke}" stroke-width="${(1.6 + random() * 1.4).toFixed(1)}" stroke-linecap="round" opacity="${(0.10 + random() * 0.14).toFixed(2)}"/>`);
    }
  }
  if (category === "snow") {
    for (let i = 0; i < 70; i += 1) {
      streaks.push(`<circle cx="${(random() * width).toFixed(0)}" cy="${(random() * height).toFixed(0)}" r="${(2 + random() * 4).toFixed(1)}" fill="white" opacity="${(0.15 + random() * 0.3).toFixed(2)}"/>`);
    }
  }

  const defs = `
    <filter id="atmosphereBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="80"/></filter>
    <linearGradient id="atmosphereShade" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0.2" stop-color="rgb(8,17,34)" stop-opacity="0"/><stop offset="1" stop-color="rgb(8,17,34)" stop-opacity="0.45"/></linearGradient>`;
  const body = `
  <rect width="${width}" height="${height}" fill="${pageColor}"/>
  <rect width="${width}" height="${height}" fill="${base.color}" opacity="${base.opacity.toFixed(2)}"/>
  <g filter="url(#atmosphereBlur)">${blobs.join("")}</g>
  ${streaks.join("")}
  <rect width="${width}" height="${height}" fill="url(#atmosphereShade)"/>`;
  return { defs, body };
};
