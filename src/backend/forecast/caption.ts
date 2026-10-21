import { config } from "../../config.js";
import type { Place } from "../sources/types.js";
import { schoolOverride } from "./school.js";

type N = number | null;

export interface HourlyPoint {
  temp: N;
  feel: N;
  /** Precipitation probability, percent. */
  pop: N;
  /** Inches in the hour. */
  precip: N;
  /** Inches in the hour. */
  snow: N;
  /** Wind gust, mph. */
  gust: N;
  cloud: N;
  /** WMO weather code; 95 and up is thunderstorm. */
  code: N;
}

export interface DayPoint {
  date: string;
  high: N;
  low: N;
  pop: N;
  snow: N;
}

export interface Alert {
  event: string;
  expires?: string;
}

export interface CaptionInput {
  label: string;
  /** The place's local date, YYYY-MM-DD. */
  date: string;
  timeZone: string;
  schoolDay: boolean;
  /** Today's hours, indexed by hour of day. May be empty when the forecast could not be loaded. */
  hours: HourlyPoint[];
  today?: DayPoint;
  yesterday?: DayPoint;
  /** The days after today, in order. */
  ahead: DayPoint[];
  /** Active NWS alerts; null when they could not be checked, so the caption never claims "no alerts". */
  alerts: Alert[] | null;
}

export interface CaptionResult {
  text: string;
  /** Which forecast angle led the caption, so posts can be compared with their insights later. */
  topic: string;
  question: boolean;
}

const NONE: HourlyPoint = { temp: null, feel: null, pop: null, precip: null, snow: null, gust: null, cloud: null, code: null };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const hourLabel = (h: number): string => `${h % 12 || 12} ${h % 24 < 12 ? "AM" : "PM"}`;
const round = (v: number): number => Math.round(v);
const maxOf = (values: number[]): number | null => (values.length ? Math.max(...values) : null);
const nums = (points: HourlyPoint[], key: keyof HourlyPoint): number[] =>
  points.map((p) => p[key]).filter((v): v is number => v !== null);

/** What the alert means and what to do, by kind of hazard. Stays generic so it is always accurate. */
const protectiveAction = (event: string): string => {
  if (/tornado/i.test(event)) return "Move to an interior room on the lowest floor and stay away from windows.";
  if (/flood/i.test(event)) return "Never drive through flooded roads.";
  if (/thunderstorm/i.test(event)) return "Head indoors when thunder is heard.";
  if (/winter|snow|ice|blizzard|freezing rain|sleet/i.test(event)) return "Allow extra time to travel, and expect slick roads and sidewalks.";
  if (/wind/i.test(event)) return "Secure loose outdoor items.";
  if (/heat/i.test(event)) return "Drink plenty of water and limit time outdoors.";
  if (/freeze|frost|cold/i.test(event)) return "Protect pets, pipes and sensitive plants.";
  return "Follow guidance from local officials.";
};

const alertRank = (event: string): number => (/warning/i.test(event) ? 0 : /watch/i.test(event) ? 1 : 2);

/**
 * Builds the Instagram caption from a day's forecast. Pure and deterministic: the date picks between wording variants
 * (so consecutive days differ, and a question never repeats on back-to-back posts) and the data picks the angle.
 * `style: "plain"` drops the questions and sharing prompts, as a baseline to compare against.
 */
export const composeCaption = (input: CaptionInput, options: { style?: "auto" | "plain" } = {}): CaptionResult => {
  const { label, date, hours, today, yesterday, ahead, alerts, schoolDay } = input;
  const [year, month, day] = date.split("-").map(Number);
  const n = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const pick = <T>(items: T[], salt = 0): T => items[(n + salt) % items.length];

  const town = label.split(",")[0].trim() || "your area";
  const local = /edgemont|scarsdale|westchester/i.test(label);
  const T = local ? pick(["Edgemont", "Scarsdale"]) : town;
  const area = local ? "Westchester" : town;
  const tags = local
    ? ["#WestchesterWeather", "#ScarsdaleNY", "#Edgemont", pick(["#WestchesterNY", "#LocalWeather"])]
    : [`#${town.replace(/\W/g, "")}Weather`, "#LocalWeather"];

  const assemble = (paragraphs: string[], hashtags: string[]): string => [...paragraphs.filter(Boolean), hashtags.join(" ")].join("\n\n");

  // Hazards from actual NWS watches, warnings and advisories come first, with no engagement hooks.
  if (alerts && alerts.length > 0) {
    const sorted = [...alerts].sort((a, b) => alertRank(a.event) - alertRank(b.event));
    const events = [...new Set(sorted.map((a) => a.event))].slice(0, 2);
    const art = (e: string): string => (/^[aeiou]/i.test(e) ? "an" : "a");
    const expires = sorted[0].expires ? new Date(sorted[0].expires) : null;
    const until =
      expires && !Number.isNaN(expires.getTime())
        ? ` until ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", timeZone: input.timeZone }).format(expires)}`
        : "";
    const top = sorted[0].event;
    const meaning = /warning/i.test(top)
      ? "A warning means the hazard is occurring or expected soon."
      : /watch/i.test(top)
        ? "A watch means conditions are favorable for this hazard, but it is not happening yet."
        : "An advisory means conditions are expected to cause inconvenience.";
    const where = local ? "Scarsdale and Westchester" : town;
    return {
      text: assemble(
        [
          `${where}: the National Weather Service has issued ${events.map((e) => `${art(e)} ${e}`).join(" and ")}${until}.`,
          `${meaning} ${protectiveAction(top)}`,
          "Check weather.gov for the full details and updates."
        ],
        tags.slice(0, 2)
      ),
      topic: "nws-alert",
      question: false
    };
  }

  const high = today?.high ?? null;
  const low = today?.low ?? null;
  if (hours.length === 0 && high === null) {
    return {
      text: assemble(
        [`${T} weather: today's forecast is in the image above.`, local ? "Check back through the day for Scarsdale and Westchester updates." : ""],
        tags.slice(0, 2)
      ),
      topic: "no-data",
      question: false
    };
  }

  const at = (h: number): HourlyPoint => hours[h] ?? NONE;
  const morning = at(7).temp;
  const feel7 = at(7).feel;
  const daytime = hours.slice(8, 21);
  const gusts = nums(daytime, "gust");
  const gust = maxOf(gusts);
  const peaks = daytime.flatMap((p, i) => (gust !== null && (p.gust ?? 0) >= gust - 1 ? [8 + i] : []));
  const gustHour = peaks.length ? Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) : 0;
  const wet: number[] = [];
  for (let h = 5; h <= 22; h++) if ((at(h).precip ?? 0) >= 0.01 && (at(h).pop ?? 0) >= 40) wet.push(h);
  const wetFirst = wet[0];
  const wetLast = wet[wet.length - 1];
  const wetPop = maxOf(wet.map((h) => at(h).pop ?? 0));
  const frozen = wet.some((h) => (at(h).snow ?? 0) >= 0.05 || ((at(h).temp ?? 99) <= 32));
  const when = wet.length === 0 ? "" : wetLast - wetFirst >= 2 ? `from about ${hourLabel(wetFirst)} to ${hourLabel(wetLast + 1)}` : `around ${hourLabel(wetFirst)}`;
  const snowToday = today?.snow ?? null;
  const stormHours = hours.filter((p) => (p.code ?? 0) >= 95).length > 0;
  const stormFirst = hours.findIndex((p) => (p.code ?? 0) >= 95);
  const clouds = nums(hours.slice(10, 17), "cloud");
  const cloudAvg = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null;
  const dry = wet.length === 0 && (today?.pop ?? 0) < 30;
  const tomorrow = ahead[0];
  const season = month >= 9 && month <= 11 ? "fall" : month === 12 || month <= 2 ? "winter" : month <= 5 ? "spring" : "summer";
  const monthName = MONTHS[month - 1];
  const notAlerts = alerts ? `No NWS watch or warning is in effect for ${local ? "Westchester" : "the area"} right now.` : "Check weather.gov for any watches or warnings.";

  interface Topic {
    topic: string;
    score: number;
    hook: string;
    body: string[];
    share?: string;
    questions?: string[];
    /** Serious weather: no questions or sharing prompts. */
    serious?: boolean;
  }
  const topics: Topic[] = [];

  if (stormHours && wet.length > 0 && stormFirst >= 0) {
    topics.push({
      topic: "storm-possible",
      score: 88,
      hook: `Thunderstorms are possible in ${T} around ${hourLabel(stormFirst)}, based on forecast models.`,
      body: [`This is model guidance, not an NWS alert, and timing can shift. ${notAlerts}`, "If you hear thunder, head indoors."],
      serious: true
    });
  }

  if (snowToday !== null && (snowToday >= 0.1 || (wet.length > 0 && frozen))) {
    const light = snowToday < 1;
    topics.push({
      topic: "snow-today",
      score: 90,
      hook: light
        ? pick([`Light snow is possible in ${T} ${when || "today"}.`, `${T}, a little snow could show up ${when || "today"}.`, `Snow is in today's ${area} forecast — here's the timing.`])
        : pick([`Snow could make travel tricky in ${T} ${when || "today"}.`, `${T}, snow is on the way ${when || "today"}.`, `Snow is in today's ${area} forecast — here's the timing.`]),
      body: [
        `${wetPop ? `${round(wetPop)}% chance` : "A chance"} of snow${when ? ` ${when}` : ""}${snowToday >= 0.5 ? `, with about ${snowToday.toFixed(1)} inches possible` : ", with little to no accumulation expected"}. Timing and totals can shift, so check back for updates.`,
        !light ? "Allow extra time on the roads and sidewalks." : low !== null && low <= 34 ? "Not much should stick, but watch for slick spots where it does." : ""
      ],
      share: !light ? "Passing this along to anyone driving or walking to school or work?" : undefined,
      serious: snowToday >= 3
    });
  }

  const snowAhead = ahead.slice(0, 3).findIndex((d) => (d.snow ?? 0) >= 0.1 && (d.pop ?? 0) >= 40);
  if (snowAhead >= 0 && !(snowToday && snowToday >= 0.1)) {
    const d = ahead[snowAhead];
    const [dy, dm, dd] = d.date.split("-").map(Number);
    const dow = DAYS[new Date(Date.UTC(dy, dm - 1, dd)).getUTCDay()];
    topics.push({
      topic: "snow-ahead",
      score: 80,
      hook: pick([`Could ${T} see snow this week? Here's what the forecast shows.`, `Snow shows up in the ${area} forecast for ${dow}.`]),
      body: [
        `${dow} has a ${round(d.pop ?? 0)}% chance of snow${d.high !== null ? `, with a high near ${round(d.high)}°F` : ""}. It's still ${snowAhead + 1} days out, so details could change.`
      ],
      share: "Planning travel or outdoor activities? Keep an eye on it.",
      questions: month >= 11 || month <= 3 ? ["Anyone else hoping for snow this winter?"] : undefined,
      serious: (d.snow ?? 0) >= 3
    });
  }

  if (schoolDay && wet.some((h) => h >= 14 && h <= 17)) {
    topics.push({
      topic: "rain-dismissal",
      score: 85,
      hook: pick([`${T} students: keep an umbrella handy after school.`, `Rain is lined up for dismissal in ${T} today.`, `Heads up, ${T}: wet weather arrives around the final bell.`]),
      body: [
        `Rain looks most likely ${when}, with a ${round(wetPop ?? 0)}% chance.${wetFirst >= 11 ? " Until then, it stays mostly dry." : ""}`,
        "Practices, backpacks and the ride or walk home could get wet."
      ],
      share: pick(["Know someone heading out after school? They'll want to bring an umbrella.", "Worth sending to a parent doing pickup today."])
    });
  } else if (schoolDay && wetFirst !== undefined && wetFirst <= 8) {
    topics.push({
      topic: "rain-morning",
      score: 75,
      hook: pick([`A wet start to the day in ${T}: plan for rain ${when}.`, `${T}, rain could affect the morning commute ${when}.`]),
      body: [`Chance of rain is ${round(wetPop ?? 0)}%. Leave a little extra time for the morning drive and drop-off.`],
      share: "Send this to anyone with an early commute."
    });
  } else if (wet.length > 0 && !frozen) {
    const sure = (wetPop ?? 0) >= 60;
    topics.push({
      topic: "rain",
      score: 70,
      hook: sure
        ? pick([`Plan around the rain in ${T} ${when}.`, `${T}, the rain should arrive ${when}.`, `Rain moves through ${area} ${when}.`])
        : pick([`Rain could pass through ${T} ${when} — but it's not a sure thing.`, `A shower is possible in ${T} ${when}.`]),
      body: [
        `${round(wetPop ?? 0)}% chance of rain. ${sure ? "Most of the rest of the day should be drier." : "Timing is uncertain, so check back for updates."}`,
        weekend ? "Outdoor games and plans may need a backup." : "A quick umbrella check before heading out could save you."
      ],
      share: weekend ? "Planning something outdoors? Keep an eye on the forecast." : undefined,
      questions: weekend || weekday === 5 ? ["Rainy weekends or sunny weekdays — which would you prefer?"] : undefined
    });
  }

  if (gust !== null && gust >= 30) {
    const part = gustHour >= 12 ? "afternoon" : "morning";
    const strong = gust >= 45;
    topics.push({
      topic: "wind",
      score: strong ? 83 : 72,
      hook: strong
        ? `Strong wind gusts of up to ${round(gust)} mph are in the ${T} forecast.`
        : pick([`It's going to be a windy ${part} across ${T}.`, `Gusts up to ${round(gust)} mph are expected in ${T} this ${part}.`, `Hold onto your hat, ${T}: gusts could reach ${round(gust)} mph.`]),
      body: [
        `Gusts peak around ${hourLabel(gustHour)}. ${strong ? `Secure loose outdoor items. ${notAlerts}` : (at(gustHour).feel ?? 99) < (at(gustHour).temp ?? 0) - 3 ? "The wind will make it feel colder than the temperature says." : "Loose items outside may blow around."}`
      ],
      share: strong ? undefined : "Heading to an outdoor practice or game? Expect a breezy one.",
      serious: strong
    });
  }

  if (morning !== null && high !== null && high - morning >= 20) {
    const swing = round(high - morning);
    topics.push({
      topic: "warmup",
      score: 78,
      hook: morning <= 50 && high >= 60 ? "A chilly morning, but a surprisingly warm afternoon ahead." : `From ${round(morning)}°F this morning to ${round(high)}°F by afternoon — ${T} is in for a big swing.`,
      body: [`That's a ${swing}-degree climb, so layers you can shed will work better than one heavy coat.`, schoolDay ? "Worth knowing before the walk to the bus stop." : ""],
      share: "Send this to anyone packing a bag for the day.",
      questions: ["Layers or one big coat on mornings like this — which are you?"]
    });
  }

  if (feel7 !== null && feel7 <= 45) {
    const freezing = feel7 <= 32;
    topics.push({
      topic: "cold-morning",
      score: freezing ? 74 : 65,
      hook: freezing ? `${T}, you're going to want a heavy coat this morning.` : `${T}, you're going to want a jacket this morning.`,
      body: [
        `It feels like ${round(feel7)}°F at 7 AM${high !== null && morning !== null && high - morning >= 10 ? `, then recovers to ${round(high)}°F this afternoon` : ""}.`,
        schoolDay ? "Dress for the walk to the bus stop." : ""
      ],
      share: "Passing this along to anyone with an early practice or commute.",
      questions: season === "fall" || season === "winter" ? ["Are you ready for colder mornings?"] : undefined
    });
  }

  if (high !== null && tomorrow?.high != null && tomorrow.high <= high - 12) {
    topics.push({
      topic: "drop-tomorrow",
      score: 68,
      hook: "Enjoy today's warmth — a colder day is coming.",
      body: [`Highs go from ${round(high)}°F today to ${round(tomorrow.high)}°F tomorrow.`, "If you have outdoor plans, today is the better day for them."],
      share: "Worth passing along to anyone planning something outside.",
      questions: ["Are you ready for colder mornings?"]
    });
  }

  if (high !== null && yesterday?.high != null && Math.abs(high - yesterday.high) >= 12) {
    const colder = high < yesterday.high;
    topics.push({
      topic: colder ? "cooler-than-yesterday" : "warmer-than-yesterday",
      score: colder ? 70 : 66,
      hook: colder
        ? `Noticeably cooler today, ${T}: about ${round(yesterday.high - high)} degrees colder than yesterday.`
        : `Warmer today, ${T} — about ${round(high - yesterday.high)} degrees above yesterday's high.`,
      body: [`High near ${round(high)}°F after ${round(yesterday.high)}°F yesterday, so ${colder ? "adjust your layers" : "lighten up your layers"}.`],
      questions: colder && (season === "fall" || season === "winter") ? ["Are you ready for colder mornings?"] : undefined
    });
  }

  if (high !== null && high >= 85) {
    topics.push({
      topic: "heat",
      score: high >= 90 ? 76 : 55,
      hook: `A hot one in ${T}: highs near ${round(high)}°F.`,
      body: [`Plan outdoor practices and errands for earlier or later in the day, and keep water handy.`],
      share: "Send this to anyone with outdoor practice today."
    });
  }

  if (weekday === 5) {
    const wk = ahead.slice(0, 2).filter((d) => (d.pop ?? 0) >= 50 || (d.snow ?? 0) >= 0.1);
    if (wk.length > 0) {
      topics.push({
        topic: "weekend-outlook",
        score: 69,
        hook: pick([`Planning something outdoors this weekend? Here's what the forecast shows for ${T}.`, `The ${area} weekend forecast has a wet spot in it.`]),
        body: [
          `${wk.map((d) => `${DAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()]} has a ${round(d.pop ?? 0)}% chance of ${(d.snow ?? 0) >= 0.1 ? "snow" : "rain"}`).join(", ")}. Things can still shift, so check back.`
        ],
        share: "Send this to whoever is organizing weekend plans.",
        questions: ["Rainy weekends or sunny weekdays — which would you prefer?"]
      });
    }
  }

  if (high !== null && high >= 60 && high <= 80 && dry && (gust ?? 0) < 22) {
    const sky = cloudAvg === null ? "dry weather" : cloudAvg < 30 ? "sunshine" : cloudAvg < 70 ? "a mix of sun and clouds" : "clouds but no rain";
    const wind = (gust ?? 0) < 15 ? "a light wind" : "a light breeze";
    const yWet = (yesterday?.pop ?? 0) >= 50;
    const next =
      tomorrow?.high != null && Math.abs(tomorrow.high - high) <= 4 && (tomorrow.pop ?? 0) < 30
        ? "Tomorrow looks similar."
        : (tomorrow?.pop ?? 0) >= 50
          ? `Rain returns tomorrow (${round(tomorrow!.pop!)}% chance).`
          : "";
    topics.push({
      topic: "pleasant",
      score: weekend ? 58 : 50,
      hook: yWet
        ? "Finally, a great afternoon to spend outside."
        : pick([`Today looks like a good one to spend outside in ${T}.`, `Dry, comfortable and calm — ${T} has a nice one today.`, `${T}, this is the kind of afternoon worth getting outside for.`]),
      body: [
        pick(
          [
            `Expect ${sky}, ${wind} and a high near ${round(high)}°F.`,
            morning !== null ? `A ${morning <= 52 ? "cool" : "mild"} ${round(morning)}°F start warms to ${round(high)}°F with ${sky}.` : `Highs reach ${round(high)}°F with ${sky}.`,
            `Highs reach ${round(high)}°F with ${sky} and ${wind}.`
          ],
          1
        ),
        weekend ? `A good window for outdoor plans around ${area}.` : schoolDay ? pick(["Good conditions for after-school sports and time outside.", "Recess, practices and the walk home all look dry."], 1) : "",
        next
      ],
      share: weekend ? "Passing this along to anyone planning time outdoors." : undefined,
      questions: weekend
        ? ["What's on the agenda outside today?"]
        : season === "fall" || season === "spring"
          ? ["Is this your ideal weather?", `Would you rather have 50°F or 70°F in ${monthName}?`]
          : season === "winter"
            ? ["Cold and sunny or mild and gray — which do you prefer?"]
            : ["Hot and sunny or cooler and breezy — what's your pick?"]
    });
  }

  // Routine fallback, with the angle taken from the temperature band.
  const band = high === null ? 2 : high <= 45 ? 0 : high <= 60 ? 1 : high <= 75 ? 2 : 3;
  const tens = high === null ? "" : `${Math.floor(high / 10) * 10}s`;
  topics.push({
    topic: "routine",
    score: 30,
    hook: [
      pick([`A properly cold day in ${T}: highs only reach the ${tens}.`, `${T}, bundle up — highs stay in the ${tens}.`]),
      pick([`A crisp one in ${T} today — light jacket weather.`, `${T}, layers will do the work today.`]),
      pick([`Easy weather in ${T} today, with highs near ${high !== null ? round(high) : 70}°F.`, `${T} gets a comfortable one today.`]),
      pick([`Warm in ${T} today, with highs near ${high !== null ? round(high) : 80}°F.`, `${T}, it's a warm one today — dress light.`])
    ][band],
    body: [
      [low !== null ? `Lows dip to ${round(low)}°F overnight, so the morning will feel colder than the afternoon.` : "Dress for the colder morning.", "Mild and quiet otherwise.", `Check the image for hour-by-hour timing across ${area}.`, "Stay hydrated if you're outside for long."][band],
      !dry ? "A few showers are possible, so keep the umbrella nearby." : ""
    ],
    questions: season === "fall" ? ["Is this your ideal fall weather?"] : season === "winter" ? ["Cold and sunny or mild and gray — which do you prefer?"] : undefined
  });

  const chosen = topics.sort((a, b) => b.score - a.score)[0];
  const plain = options.style === "plain";
  // About one post in three gets a question, never two in a row, and rotating through the topic's pool.
  const question = !plain && !chosen.serious && n % 3 === 1 && chosen.questions ? chosen.questions[Math.floor(n / 3) % chosen.questions.length] : undefined;
  const share = !plain && !chosen.serious ? chosen.share : undefined;

  const body = chosen.body.filter(Boolean).join(" ");
  const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
  const extras = [share, question].filter((s): s is string => Boolean(s));
  // Keep routine posts inside about 100 words by dropping the optional lines first.
  while (extras.length > 0 && words([chosen.hook, body, ...extras].join(" ")) > 100) extras.pop();

  return {
    text: assemble([chosen.hook, body, extras.join(" ")], chosen.serious ? tags.slice(0, 3) : tags),
    topic: chosen.topic,
    question: question !== undefined && extras.includes(question)
  };
};

const fetchJson = async (url: URL, headers: Record<string, string> = {}): Promise<any> => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url.hostname} returned ${response.status}`);
  return response.json();
};

/** Loads the forecast for a place and writes its caption. A failed lookup gives a short keyword caption instead of an error. */
export const buildCaption = async (place: Place, now: Date = new Date()): Promise<CaptionResult> => {
  const label = place.label ?? "";
  const lat = place.latitude.toFixed(4);
  const lon = place.longitude.toFixed(4);
  const input: CaptionInput = {
    label,
    date: new Intl.DateTimeFormat("en-CA", { timeZone: config.dailyTimezone }).format(now),
    timeZone: config.dailyTimezone,
    schoolDay: false,
    hours: [],
    ahead: [],
    alerts: null
  };

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,wind_gusts_10m,cloud_cover,weather_code");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("precipitation_unit", "inch");
    url.searchParams.set("past_days", "1");
    url.searchParams.set("forecast_days", "5");
    url.searchParams.set("timezone", "auto");
    const data = await fetchJson(url);
    input.timeZone = data.timezone ?? input.timeZone;
    input.date = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone }).format(now);

    const num = (v: unknown): N => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const dayAt = (i: number): DayPoint => ({
      date: data.daily.time[i],
      high: num(data.daily.temperature_2m_max?.[i]),
      low: num(data.daily.temperature_2m_min?.[i]),
      pop: num(data.daily.precipitation_probability_max?.[i]),
      snow: num(data.daily.snowfall_sum?.[i])
    });
    const index = (data.daily.time as string[]).indexOf(input.date);
    if (index >= 0) {
      input.today = dayAt(index);
      if (index > 0) input.yesterday = dayAt(index - 1);
      for (let i = index + 1; i < data.daily.time.length; i++) input.ahead.push(dayAt(i));
    }
    const h = data.hourly;
    (h.time as string[]).forEach((time, i) => {
      if (!time.startsWith(input.date)) return;
      input.hours[Number(time.slice(11, 13))] = {
        temp: num(h.temperature_2m?.[i]),
        feel: num(h.apparent_temperature?.[i]),
        pop: num(h.precipitation_probability?.[i]),
        precip: num(h.precipitation?.[i]),
        snow: num(h.snowfall?.[i]),
        gust: num(h.wind_gusts_10m?.[i]),
        cloud: num(h.cloud_cover?.[i]),
        code: num(h.weather_code?.[i])
      };
    });
  } catch (error) {
    console.warn(`Could not load the forecast for the caption: ${(error as Error).message}`);
  }

  try {
    const url = new URL("https://api.weather.gov/alerts/active");
    url.searchParams.set("point", `${lat},${lon}`);
    const data = await fetchJson(url, { "User-Agent": "EdgeWARN-Bot", Accept: "application/geo+json" });
    input.alerts = (data.features as any[])
      .map((feature) => feature.properties)
      .filter((p) => p.status === "Actual" && p.messageType !== "Cancel")
      .map((p) => ({ event: String(p.event), expires: p.ends ?? p.expires }));
  } catch (error) {
    console.warn(`Could not check NWS alerts for the caption: ${(error as Error).message}`);
  }

  // The website decides on weekdays, but there is no school in July and August.
  input.schoolDay = schoolOverride(now) !== "off" && ![7, 8].includes(Number(input.date.slice(5, 7)));
  return composeCaption(input, { style: config.captionStyle });
};
