import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { config } from "../../config.js";
import type { Place } from "../sources/types.js";

const VIEWPORT_WIDTH = 1440;
// Tall enough for the content in almost every case. Resizing after load makes the radar redraw and sometimes stall.
const VIEWPORT_HEIGHT = 3000;
const SCALE = 2;
const PADDING = 48;
const CROP_PADDING = 24;
const LOGO_SIZE = 64;
const HEADER_GAP = 32;
const HEADER_HEIGHT = LOGO_SIZE + HEADER_GAP;
const TITLE = "Edgemont Forecast";
const LOGO_PATH = fileURLToPath(new URL("../../../assets/logo.png", import.meta.url));
const TIMEOUT_MS = 60_000;
const RADAR_TIMEOUT_MS = 20_000;

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The place's local date, such as "October 14, 2026". Falls back to this machine's date if the lookup fails. */
const localDateLabel = async (place: Place): Promise<string> => {
  let timeZone: string | undefined;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("current", "temperature_2m");
    url.searchParams.set("timezone", "auto");
    const response = await fetch(url);
    if (response.ok) timeZone = ((await response.json()) as { timezone?: string }).timezone;
  } catch {
    // The date below still renders without a time zone.
  }
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone }).format(new Date());
};

/**
 * Screenshots the website dashboard's content for a place, under a title bar with the logo and the date, with
 * padding around it. The site's header, sidebar, footer (with its disclaimer and links), and data age row are left out.
 * The page loads in a viewport tall enough to show everything without scrolling, and the padding is added by
 * placing the capture on a page of its own.
 */
export interface RenderOptions {
  /** Defaults to "png". Instagram only accepts JPEG. */
  format?: "png" | "jpeg";
  /** Width divided by height to pad the image out to, such as 4 / 5 for a feed post or 9 / 16 for a story. */
  aspect?: number;
}

export const renderDashboardImage = async (place: Place, options: RenderOptions = {}): Promise<Buffer> => {
  const url = new URL("/dashboard", config.websiteUrl);
  url.searchParams.set("location", `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`);

  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: SCALE });
    await page.goto(url.href, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });

    // The hero shows a loading or error status first, and its place name appears once the forecast arrives.
    await page.waitForSelector('section[aria-labelledby="home-hero-place"] [id="home-hero-place"]:not(span)', {
      timeout: TIMEOUT_MS
    });
    // The page's data age row reads "Radar waiting" until the radar has drawn, so wait for that to clear, but
    // still take the picture if the radar never comes.
    await page
      .waitForFunction(() => !/Radar\s*waiting/i.test(document.body.innerText), { timeout: RADAR_TIMEOUT_MS })
      .catch(() => undefined);
    await settle(2000);

    // The first-visit agreement banner and the data age row are not part of the forecast, so they stay out of the
    // image. The data age row goes last because the radar wait above reads its "Radar waiting" text.
    await page.addStyleTag({
      content:
        'section[aria-labelledby="first-visit-heading"], [class*="homeDesktop_age__"] { display: none !important; }'
    });

    const measure = () =>
      page.evaluate(() => {
        const box = document.querySelector('[class*="homeDesktop_home__"]')?.getBoundingClientRect();
        return box ? { x: box.left, y: box.top, width: box.width, height: box.height } : null;
      });
    let content = await measure();
    if (!content) throw new Error("The dashboard did not show a forecast for this location.");
    if (content.y + content.height > VIEWPORT_HEIGHT) {
      // Unusually long content, such as many alerts: grow the viewport to fit.
      await page.setViewport({
        width: VIEWPORT_WIDTH,
        height: Math.ceil(content.y + content.height),
        deviceScaleFactor: SCALE
      });
      await settle(4000);
      content = (await measure()) ?? content;
    }

    const background = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    const capture = Buffer.from(await page.screenshot({ type: "png", clip: content })).toString("base64");
    const logo = (await fs.readFile(LOGO_PATH)).toString("base64");
    const title = `${TITLE} - ${await localDateLabel(place)}`;

    let width = Math.ceil(content.width) + (PADDING + CROP_PADDING) * 2;
    let height = Math.ceil(content.height) + HEADER_HEIGHT + (PADDING + CROP_PADDING) * 2;
    // Pad out to the wanted aspect ratio. The title bar and capture stay centered on the extra space.
    if (options.aspect) {
      if (width / height > options.aspect) height = Math.ceil(width / options.aspect);
      else width = Math.ceil(height * options.aspect);
    }
    if (height > VIEWPORT_HEIGHT || width > VIEWPORT_WIDTH) {
      await page.setViewport({
        width: Math.max(width, VIEWPORT_WIDTH),
        height: Math.max(height, VIEWPORT_HEIGHT),
        deviceScaleFactor: SCALE
      });
    }

    // Lay the title bar and the capture over the live page, which has already loaded the site's Sora font.
    await page.evaluate(
      async (frame) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = `position:fixed;left:0;top:0;width:${frame.width}px;height:${frame.height}px;z-index:2147483647;box-sizing:border-box;padding:${frame.padding}px;background:${frame.background};font-family:Sora,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;`;
        overlay.innerHTML =
          `<div style="width:${frame.contentWidth + frame.cropPadding * 2}px"><div style="display:flex;align-items:center;gap:20px;height:${frame.logoSize}px;margin-bottom:${frame.gap}px">` +
          `<img alt="" width="${frame.logoSize}" height="${frame.logoSize}" style="border-radius:16px" src="data:image/png;base64,${frame.logo}">` +
          `<div style="color:#f8fbff;font-size:40px;font-weight:700;letter-spacing:-0.01em"></div></div>` +
          `<div style="padding:${frame.cropPadding}px"><img alt="" style="display:block" width="${frame.contentWidth}" height="${frame.contentHeight}" src="data:image/png;base64,${frame.capture}"></div></div>`;
        overlay.querySelector(":scope > div > div > div")!.textContent = frame.title;
        document.body.append(overlay);
        await document.fonts.ready;
        await Promise.all([...overlay.querySelectorAll("img")].map((img) => img.decode()));
      },
      {
        width,
        height,
        padding: PADDING,
        cropPadding: CROP_PADDING,
        background,
        logoSize: LOGO_SIZE,
        gap: HEADER_GAP,
        logo,
        capture,
        title,
        contentWidth: content.width,
        contentHeight: content.height
      }
    );
    return Buffer.from(
      await page.screenshot(
        options.format === "jpeg"
          ? { type: "jpeg", quality: 92, clip: { x: 0, y: 0, width, height } }
          : { type: "png", clip: { x: 0, y: 0, width, height } }
      )
    );
  } finally {
    await browser.close();
  }
};
