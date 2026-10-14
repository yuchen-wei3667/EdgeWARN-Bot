import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ASSETS_DIR, registerFonts } from "./fonts.js";
import { buildBackground } from "./background.js";
import { ICONS } from "./icons.js";
import { formatHour } from "./summarize.js";
import type { DailyForecast, HazardKind, Sky } from "./types.js";

export const FORECAST_WIDTH = 1080;
export const FORECAST_HEIGHT = 1350;

const COLORS = {
  bg: "#060c1a",
  text: "#f8fbff",
  text2: "#dce8f5",
  muted: "#94a3b8",
  cyan: "#67e8f9",
  sky: "#38bdf8",
  amber: "#facc15"
};

// Two soft glows behind the header, tinted by the day's weather like the website's forecast cards.
const GLOWS: Record<Sky, [string, string]> = {
  clear: ["rgba(250,204,21,0.20)", "rgba(56,189,248,0.14)"],
  partly: ["rgba(250,204,21,0.16)", "rgba(56,189,248,0.16)"],
  cloud: ["rgba(148,163,184,0.20)", "rgba(56,189,248,0.10)"],
  fog: ["rgba(148,163,184,0.22)", "rgba(148,163,184,0.10)"],
  rain: ["rgba(56,189,248,0.22)", "rgba(103,232,249,0.12)"],
  snow: ["rgba(186,230,253,0.22)", "rgba(148,163,184,0.12)"],
  thunder: ["rgba(167,139,250,0.26)", "rgba(251,113,133,0.16)"]
};

interface HazardTheme {
  accent: string;
  glow: [string, string];
  /** Left, middle, and right colors of the temperature line. */
  curve: [string, string, string];
  peak: string;
}

// Each hazard recolors the glows and the temperature line, while the layout stays the same.
const HAZARD_THEMES: Record<HazardKind, HazardTheme> = {
  severe: {
    accent: "#a78bfa",
    glow: ["rgba(167,139,250,0.30)", "rgba(251,113,133,0.20)"],
    curve: ["#38bdf8", "#a78bfa", "#fb7185"],
    peak: "#fb7185"
  },
  flood: {
    accent: "#38bdf8",
    glow: ["rgba(37,99,235,0.32)", "rgba(103,232,249,0.16)"],
    curve: ["#67e8f9", "#38bdf8", "#3b82f6"],
    peak: "#67e8f9"
  },
  heat: {
    accent: "#f97316",
    glow: ["rgba(239,68,68,0.28)", "rgba(250,204,21,0.20)"],
    curve: ["#facc15", "#f97316", "#ef4444"],
    peak: "#ef4444"
  },
  winter: {
    accent: "#bae6fd",
    glow: ["rgba(186,230,253,0.26)", "rgba(129,140,248,0.18)"],
    curve: ["#e0f2fe", "#93c5fd", "#818cf8"],
    peak: "#e0f2fe"
  }
};

const DEFAULT_CURVE: [string, string, string] = ["#38bdf8", "#facc15", "#f97316"];

const MARGIN = 60;
const CONTENT_WIDTH = FORECAST_WIDTH - MARGIN * 2;

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (
  x: number,
  y: number,
  value: string,
  size: number,
  weight: 400 | 600 | 700,
  fill: string,
  anchor: "start" | "middle" | "end" = "start"
): string =>
  `<text x="${x}" y="${y}" font-family="Sora" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;

const icon = (name: string, x: number, y: number, size: number, stroke: string, strokeWidth: number): string =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.cloud}</g>`;

/** Splits text into balanced lines no wider than maxChars, so headlines don't end on a lone word. */
export const wrapText = (value: string, maxChars: number): string[] => {
  const words = value.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);

  if (lines.length === 2) {
    // Move words down while it makes the two lines closer in length.
    let [a, b] = lines;
    for (;;) {
      const parts = a.split(" ");
      if (parts.length < 2) break;
      const moved = parts.pop()!;
      const nextA = parts.join(" ");
      const nextB = `${moved} ${b}`;
      if (Math.abs(nextA.length - nextB.length) < Math.abs(a.length - b.length) && nextB.length <= maxChars) {
        a = nextA;
        b = nextB;
      } else break;
    }
    return [a, b];
  }

  return lines;
};

const buildCurve = (forecast: DailyForecast, top: number): string => {
  const { hours, peakIndex } = forecast;
  const peakColor = forecast.hazard ? HAZARD_THEMES[forecast.hazard.kind].peak : COLORS.amber;
  const left = MARGIN + 38;
  const right = FORECAST_WIDTH - MARGIN - 38;
  const plotTop = top + 120;
  const plotBottom = top + 250;
  const rainBase = top + 322;
  const rainMax = 40;

  const temps = hours.map((h) => h.temperature);
  const lo = Math.min(...temps) - 4;
  const hi = Math.max(...temps) + 2;
  const x = (i: number) => left + (i * (right - left)) / Math.max(hours.length - 1, 1);
  const y = (t: number) => plotTop + (1 - (t - lo) / (hi - lo)) * (plotBottom - plotTop);
  const pts = hours.map((h, i): [number, number] => [x(i), y(h.temperature)]);

  // Catmull-Rom to Bezier, so the line passes through every sample without kinks.
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    line += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const area = `${line} L${pts[pts.length - 1][0]},${plotBottom + 24} L${pts[0][0]},${plotBottom + 24} Z`;
  const peak = pts[peakIndex];
  const barWidth = Math.min(22, ((right - left) / Math.max(hours.length - 1, 1)) * 0.6);

  const bars = hours
    .map((h, i) => {
      const height = Math.max(h.precipChance > 0 ? 3 : 0, (h.precipChance / 100) * rainMax);
      const opacity = 0.35 + h.precipChance / 160;
      return `<rect x="${(x(i) - barWidth / 2).toFixed(1)}" y="${rainBase - height}" width="${barWidth.toFixed(1)}" height="${height}" rx="3" fill="${COLORS.sky}" opacity="${opacity.toFixed(2)}"/>`;
    })
    .join("");
  // Label every fourth hour so the axis stays quiet.
  const labels = hours
    .map((h, i) => (i % 4 === 0 ? text(x(i), rainBase + 34, formatHour(h.hour), 17, 400, COLORS.muted, "middle") : ""))
    .join("");

  return `
    <path d="${area}" fill="url(#area)"/>
    <path d="${line}" fill="none" stroke="url(#stroke)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${peak[0]}" cy="${peak[1]}" r="15" fill="${peakColor}" opacity="0.25"/>
    <circle cx="${peak[0]}" cy="${peak[1]}" r="7" fill="${peakColor}"/>
    ${text(peak[0], peak[1] - 26, `${Math.round(hours[peakIndex].temperature)}°`, 26, 700, COLORS.text, "middle")}
    ${bars}${labels}`;
};

const buildPeriods = (forecast: DailyForecast, top: number, width: number): string => {
  const column = width / forecast.periods.length;
  return forecast.periods
    .map((p, i) => {
      const x = MARGIN + i * column + 30;
      const range = p.low === p.high ? `${p.high}°` : `${p.low}° to ${p.high}°`;
      return `
      ${i > 0 ? `<line x1="${MARGIN + i * column}" x2="${MARGIN + i * column}" y1="${top + 28}" y2="${top + 222}" stroke="rgba(224,243,255,0.10)"/>` : ""}
      ${icon(p.icon, x, top + 30, 44, COLORS.cyan, 1.6)}
      ${text(x + 60, top + 56, p.name, 24, 600, COLORS.text)}
      ${text(x + 60, top + 80, p.span, 15, 400, COLORS.muted)}
      ${text(x, top + 134, p.condition.length > 24 ? `${p.condition.slice(0, 23)}…` : p.condition, 21, 400, COLORS.text2)}
      ${text(x, top + 182, range, 32, 700, COLORS.text)}
      ${icon("droplets", x, top + 201, 18, COLORS.sky, 2)}
      ${text(x + 28, top + 217, `${p.precipChance}%`, 18, 400, COLORS.sky)}`;
    })
    .join("");
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** An arrow showing where the wind blows toward. Wind directions name their source, so a south wind points up. */
const windArrow = (direction: string, cx: number, cy: number, size: number): string => {
  const index = COMPASS.indexOf(direction.toUpperCase());
  const from = index < 0 ? 0 : index * 22.5;
  const half = size / 2;
  return `<g transform="translate(${cx} ${cy}) rotate(${(from + 180) % 360})" fill="none" stroke="${COLORS.cyan}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="0" y1="${half}" x2="0" y2="${-half}"/><polyline points="${-half * 0.55},${-half * 0.1} 0,${-half} ${half * 0.55},${-half * 0.1}"/></g>`;
};

const buildStats = (forecast: DailyForecast, top: number, width: number): string => {
  const { stats } = forecast;
  const items: { label: string; value: string; note: string; windDirection?: string }[] = [
    { label: "High", value: `${stats.high}°`, note: `around ${formatHour(stats.highHour)}` },
    { label: "Low", value: `${stats.low}°`, note: `around ${formatHour(stats.lowHour)}` },
    forecast.hazard?.stat ?? {
      label: "Chance of rain",
      value: `${stats.precipChance}%`,
      note: `at any point ${forecast.dayName.toLowerCase()}`
    },
    {
      label: "Wind",
      windDirection: stats.windDirection,
      value: `${stats.windSpeed}`,
      note: stats.gust > stats.windSpeed ? `mph, gusts to ${stats.gust}` : "mph"
    }
  ];
  const column = width / items.length;
  return items
    .map((item, i) => {
      const x = MARGIN + i * column + 30;
      return `
      ${i > 0 ? `<line x1="${MARGIN + i * column}" x2="${MARGIN + i * column}" y1="${top + 24}" y2="${top + 106}" stroke="rgba(224,243,255,0.10)"/>` : ""}
      ${text(x, top + 42, item.label, 17, 400, COLORS.muted)}
      ${item.windDirection ? `${windArrow(item.windDirection, x + 16, top + 72, 34)}${text(x + 44, top + 86, item.value, 36, 700, COLORS.text)}` : text(x, top + 86, item.value, 36, 700, COLORS.text)}
      ${text(x, top + 112, item.note, 16, 400, COLORS.muted)}`;
    })
    .join("");
};

export const buildForecastSvg = (forecast: DailyForecast, logoDataUri: string): string => {
  const { hazard } = forecast;
  const theme = hazard ? HAZARD_THEMES[hazard.kind] : undefined;
  const [glowA, glowB] = theme ? theme.glow : GLOWS[forecast.sky];
  const [curveA, curveB, curveC] = theme ? theme.curve : DEFAULT_CURVE;
  // Keep the headline to two lines: shrink the type before adding a third line, which would collide with the chart.
  let headlineSize = 62;
  let headlineLines = wrapText(forecast.headline, 28);
  if (headlineLines.length > 2) {
    headlineSize = 52;
    headlineLines = wrapText(forecast.headline, 36);
  }
  headlineLines = headlineLines.slice(0, 2);
  const headlineLead = Math.round(headlineSize * 1.08);
  const headlineTop = 195;
  const detailLines = wrapText(forecast.detail, 62).slice(0, 3);
  const detailTop = headlineTop + (headlineLines.length - 1) * headlineLead + 62;

  const panelTop = 400;
  const panelHeight = 400;
  const periodsTop = 826;
  const periodsHeight = 250;
  const statsTop = 1102;
  const statsHeight = 134;

  const background = buildBackground(forecast, FORECAST_WIDTH, FORECAST_HEIGHT, COLORS.bg);
  const glassFill = `fill="url(#glass)" stroke="rgba(224,243,255,0.14)"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FORECAST_WIDTH}" height="${FORECAST_HEIGHT}" viewBox="0 0 ${FORECAST_WIDTH} ${FORECAST_HEIGHT}">
  <defs>${background.defs}
    <radialGradient id="glowA" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(886 80) scale(760 520)"><stop offset="0" stop-color="${glowA}"/><stop offset="1" stop-color="${glowA}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowB" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(86 460) scale(650 420)"><stop offset="0" stop-color="${glowB}"/><stop offset="1" stop-color="${glowB}" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignette" gradientUnits="userSpaceOnUse" cx="540" cy="675" r="900"><stop offset="0.4" stop-color="${COLORS.bg}" stop-opacity="0"/><stop offset="1" stop-color="${COLORS.bg}"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="rgb(5,18,32)" stop-opacity="0.72"/><stop offset="1" stop-color="rgb(5,18,32)" stop-opacity="0.72"/></linearGradient>
    <linearGradient id="stroke" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${curveA}"/><stop offset="0.55" stop-color="${curveB}"/><stop offset="1" stop-color="${curveC}"/></linearGradient>
    <linearGradient id="range" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset="0.52" stop-color="#facc15"/><stop offset="1" stop-color="#f97316"/></linearGradient>
    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${curveB}" stop-opacity="0.22"/><stop offset="1" stop-color="${curveB}" stop-opacity="0"/></linearGradient>
    <clipPath id="logo"><rect x="${MARGIN}" y="56" width="56" height="56" rx="14"/></clipPath>
  </defs>
  ${background.body}
  <rect width="${FORECAST_WIDTH}" height="${FORECAST_HEIGHT}" fill="url(#glowA)"/>
  <rect width="${FORECAST_WIDTH}" height="${FORECAST_HEIGHT}" fill="url(#glowB)"/>
  <rect width="${FORECAST_WIDTH}" height="${FORECAST_HEIGHT}" fill="url(#vignette)"/>

  <image href="${logoDataUri}" x="${MARGIN}" y="56" width="56" height="56" clip-path="url(#logo)"/>
  ${text(MARGIN + 74, 82, forecast.place, 26, 700, COLORS.text)}
  ${text(MARGIN + 74, 108, forecast.dateLabel, 19, 400, COLORS.muted)}
  ${text(FORECAST_WIDTH - MARGIN, 90, "EdgeWARN", 20, 700, COLORS.text2, "end")}

  ${headlineLines.map((line, i) => text(MARGIN, headlineTop + i * headlineLead, line, headlineSize, 600, COLORS.text)).join("\n  ")}
  ${detailLines.map((line, i) => text(MARGIN, detailTop + i * 36, line, 24, 400, COLORS.text2)).join("\n  ")}

  <rect x="${MARGIN}" y="${panelTop}" width="${CONTENT_WIDTH}" height="${panelHeight}" rx="20" ${glassFill}/>
  ${text(MARGIN + 28, panelTop + 46, `${forecast.dayName}, hour by hour`, 22, 600, COLORS.text)}
  ${text(FORECAST_WIDTH - MARGIN - 28, panelTop + 46, forecast.windowLabel, 18, 400, COLORS.muted, "end")}
  ${text(MARGIN + 28, panelTop + 76, `Temperature, with chance of ${forecast.hazard?.kind === "winter" ? "snow or ice" : "rain"} below`, 17, 400, COLORS.muted)}
  ${buildCurve(forecast, panelTop)}

  <rect x="${MARGIN}" y="${periodsTop}" width="${CONTENT_WIDTH}" height="${periodsHeight}" rx="20" ${glassFill}/>
  ${buildPeriods(forecast, periodsTop, CONTENT_WIDTH)}

  <rect x="${MARGIN}" y="${statsTop}" width="${CONTENT_WIDTH}" height="${statsHeight}" rx="20" ${glassFill}/>
  ${buildStats(forecast, statsTop, CONTENT_WIDTH)}

  ${text(MARGIN, FORECAST_HEIGHT - 52, forecast.sample ? "Sample data for design preview" : hazard ? "NWS forecast data. Not an official warning." : "Forecast data: National Weather Service", 17, 400, COLORS.muted)}
  ${text(FORECAST_WIDTH - MARGIN, FORECAST_HEIGHT - 52, forecast.madeLabel, 17, 400, COLORS.muted, "end")}
</svg>`;
};

/** Renders the daily forecast as a 1080 x 1350 PNG, sized for an Instagram portrait post. */
export const renderForecastImage = async (forecast: DailyForecast): Promise<Buffer> => {
  registerFonts();
  const logo = await fs.readFile(path.join(ASSETS_DIR, "logo.png"));
  const svg = buildForecastSvg(forecast, `data:image/png;base64,${logo.toString("base64")}`);
  return sharp(Buffer.from(svg)).png().toBuffer();
};
