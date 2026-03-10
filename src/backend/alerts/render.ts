import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { EwmrsClient } from "../sources/ewmrs.js";
import type { AlertFeature, TileInfo } from "../sources/types.js";
import type { RenderOptions, ViewportBounds } from "../types.js";
import { tileConfig } from "../../config.js";
import {
  EWMRS_EXTENT,
  buildSvgPath,
  expandBoundsToAspect,
  getMercatorBoundsForGeometry,
  mercatorToPixel,
  mercatorToSlippyTile,
  slippyTileToMercatorBounds,
  viewportZoomLevel
} from "../geo.js";

const CARTO_TILE_SIZE = 256;
const CARTO_TEMPLATE = tileConfig.urlTemplate;
const CARTO_FALLBACK = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const CARTO_BOUNDARY_TEMPLATE = tileConfig.boundaryUrlTemplate;
const CARTO_REFERENCE_TEMPLATE = tileConfig.referenceUrlTemplate;

const severityColors: Record<string, { stroke: string; fill: string }> = {
  extreme: { stroke: "#ff5f56", fill: "rgba(255,95,86,0.30)" },
  severe: { stroke: "#ff8a3d", fill: "rgba(255,138,61,0.28)" },
  moderate: { stroke: "#ffd166", fill: "rgba(255,209,102,0.24)" },
  minor: { stroke: "#70d6ff", fill: "rgba(112,214,255,0.22)" }
};

const MOBILE_BACKGROUND = "#10161d";
const PANEL_BACKGROUND = "#151c24";
const PANEL_BORDER = "rgba(255,255,255,0.08)";
const TITLE_COLOR = "#f5efe7";
const SUBTLE_TEXT = "#a6b1bc";
const METADATA_TEXT = "#eef3f7";
const MAP_FRAME = "#0f141a";

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const wrapText = (value: string, maxCharsPerLine: number, maxLines: number): string[] => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      current = word.slice(maxCharsPerLine);
    }

    if (lines.length === maxLines) {
      return lines.map((line, index) => (index === maxLines - 1 ? `${line.slice(0, Math.max(0, maxCharsPerLine - 1))}...` : line));
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).map((line, index) => (index === maxLines - 1 ? `${line.slice(0, Math.max(0, maxCharsPerLine - 1))}...` : line));
  }

  return lines;
};

const formatExpiry = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
};

const formatSectionDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
};

const cropSquare = async (input: Buffer, size: number): Promise<Buffer> => {
  const metadata = await sharp(input).metadata();
  const sourceWidth = metadata.width ?? size;
  const sourceHeight = metadata.height ?? size;
  const cropSize = Math.min(sourceWidth, sourceHeight, size);
  const left = Math.max(0, Math.floor((sourceWidth - cropSize) / 2));
  const top = Math.max(0, Math.floor((sourceHeight - cropSize) / 2));

  return sharp(input)
    .extract({ left, top, width: cropSize, height: cropSize })
    .png()
    .toBuffer();
};

const scaleOverlay = async (input: Buffer, width: number, height: number, factor: number): Promise<Buffer> => {
  if (factor === 1) {
    return input;
  }

  const scaledWidth = Math.max(width, Math.round(width * factor));
  const scaledHeight = Math.max(height, Math.round(height * factor));
  const left = Math.max(0, Math.floor((scaledWidth - width) / 2));
  const top = Math.max(0, Math.floor((scaledHeight - height) / 2));

  const scaled = await sharp(input)
    .resize({
      width: scaledWidth,
      height: scaledHeight,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false
    })
    .png()
    .toBuffer();

  return sharp(scaled)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
};

const runWithConcurrency = async <T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
};

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const headers = {
    // Provide a user-agent so tile providers don't reject the request
    "User-Agent": "EdgeWARN-Bot/1.0 (+https://example.org)",
    Accept: "image/png,image/*;q=0.8,*/*;q=0.5"
  };

  // Try a couple times for transient network errors
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }

      // Non-OK: throw to trigger fallback/ retry logic
      const msg = `Failed to fetch ${url}: ${response.status} ${response.statusText}`;
      throw new Error(msg);
    } catch (err) {
      if (attempt === 2) throw err;
      // small backoff
      await new Promise((res) => setTimeout(res, 200 + attempt * 200));
    }
  }

  throw new Error(`Failed to fetch ${url}`);
};

const clipOverlay = async (
  input: Buffer,
  left: number,
  top: number,
  canvasWidth: number,
  canvasHeight: number
): Promise<sharp.OverlayOptions | null> => {
  const metadata = await sharp(input).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const visibleWidth = Math.min(sourceWidth - cropLeft, canvasWidth - Math.max(0, left));
  const visibleHeight = Math.min(sourceHeight - cropTop, canvasHeight - Math.max(0, top));

  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return null;
  }

  const clipped =
    cropLeft > 0 || cropTop > 0 || visibleWidth !== sourceWidth || visibleHeight !== sourceHeight
      ? await sharp(input)
          .extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight })
          .png()
          .toBuffer()
      : input;

  return {
    input: clipped,
    left: Math.max(0, left),
    top: Math.max(0, top)
  };
};

const applyOpacity = async (input: Buffer, opacity: number): Promise<Buffer> => {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  for (let index = 3; index < data.length; index += info.channels) {
    data[index] = Math.round(data[index] * opacity);
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
};

const clampToExtent = (bounds: ViewportBounds): ViewportBounds => {
  const minX = Math.max(bounds.minX, EWMRS_EXTENT.west);
  const maxX = Math.min(bounds.maxX, EWMRS_EXTENT.east);
  const minY = Math.max(bounds.minY, EWMRS_EXTENT.south);
  const maxY = Math.min(bounds.maxY, EWMRS_EXTENT.north);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
};

const createTileLayer = async (
  bounds: ViewportBounds,
  width: number,
  height: number,
  template: string,
  background: string | { r: number; g: number; b: number; alpha: number },
  fallbackTemplate?: string
): Promise<Buffer> => {
  const zoom = viewportZoomLevel(bounds, width, height);
  const topLeft = mercatorToSlippyTile(bounds.minX, bounds.maxY, zoom);
  const bottomRight = mercatorToSlippyTile(bounds.maxX, bounds.minY, zoom);

  const composites: sharp.OverlayOptions[] = [];

  await Promise.all(
    Array.from({ length: bottomRight.x - topLeft.x + 1 }, (_, ix) => topLeft.x + ix).flatMap((tileX) =>
      Array.from({ length: bottomRight.y - topLeft.y + 1 }, (_, iy) => topLeft.y + iy).map(async (tileY) => {
        const subdomains = tileConfig.subdomains.length ? tileConfig.subdomains : ["a", "b", "c"];
        const s = subdomains[Math.abs(tileX + tileY) % subdomains.length];
        const url = template.replace("{s}", s)
          .replace("{z}", String(zoom))
          .replace("{x}", String(tileX))
          .replace("{y}", String(tileY));

        let tile: Buffer;
        try {
          tile = await fetchBuffer(url);
        } catch (err) {
          if (!fallbackTemplate) {
            throw err;
          }

          const fallback = fallbackTemplate.replace("{s}", s)
            .replace("{z}", String(zoom))
            .replace("{x}", String(tileX))
            .replace("{y}", String(tileY));
          tile = await fetchBuffer(fallback);
        }

        const boundsMeters = slippyTileToMercatorBounds(tileX, tileY, zoom);
        const tileLeftMeters = boundsMeters.left;
        const tileTopMeters = boundsMeters.top;
        const tileRightMeters = boundsMeters.right;
        const tileBottomMeters = boundsMeters.bottom;

        const [left, top] = mercatorToPixel(tileLeftMeters, tileTopMeters, bounds, width, height);
        const [right, bottom] = mercatorToPixel(tileRightMeters, tileBottomMeters, bounds, width, height);

        const targetWidth = Math.max(1, Math.round(right - left));
        const targetHeight = Math.max(1, Math.round(bottom - top));

        const resizedTile = await sharp(tile)
          .resize({
            width: targetWidth,
            height: targetHeight,
            kernel: sharp.kernel.nearest,
            fastShrinkOnLoad: false
          })
          .png()
          .toBuffer();

        const overlay = await clipOverlay(resizedTile, Math.round(left), Math.round(top), width, height);
        if (overlay) {
          composites.push(overlay);
        }
      })
    )
  );

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
};

const createBasemap = async (bounds: ViewportBounds, width: number, height: number): Promise<Buffer> =>
  createTileLayer(bounds, width, height, CARTO_TEMPLATE, "#0b1117", CARTO_FALLBACK);

const createReferenceOverlay = async (bounds: ViewportBounds, width: number, height: number): Promise<Buffer | null> => {
  if (!CARTO_REFERENCE_TEMPLATE) {
    return null;
  }

  try {
    return await scaleOverlay(
      await createTileLayer(
        bounds,
        width,
        height,
        CARTO_REFERENCE_TEMPLATE,
        { r: 0, g: 0, b: 0, alpha: 0 }
      ),
      width,
      height,
      1.3
    );
  } catch {
    return null;
  }
};

const createBoundaryOverlay = async (bounds: ViewportBounds, width: number, height: number): Promise<Buffer | null> => {
  if (!CARTO_BOUNDARY_TEMPLATE) {
    return null;
  }

  try {
    return await applyOpacity(
      await createTileLayer(
        bounds,
        width,
        height,
        CARTO_BOUNDARY_TEMPLATE,
        { r: 0, g: 0, b: 0, alpha: 0 }
      ),
      0.72
    );
  } catch {
    return null;
  }
};

const createRadarOverlay = async (
  client: EwmrsClient,
  tileInfo: TileInfo,
  // timestamp MUST be a normalized ISO string (use renderComposite to derive it)
  timestamp: string,
  bounds: ViewportBounds,
  width: number,
  height: number
): Promise<Buffer> => {
  const bounded = clampToExtent(bounds);
  const tileWidthMeters = (EWMRS_EXTENT.east - EWMRS_EXTENT.west) / tileInfo.cols;
  const tileHeightMeters = (EWMRS_EXTENT.north - EWMRS_EXTENT.south) / tileInfo.rows;
  const minX = Math.max(0, Math.floor((bounded.minX - EWMRS_EXTENT.west) / tileWidthMeters));
  const maxX = Math.min(tileInfo.cols - 1, Math.floor((bounded.maxX - EWMRS_EXTENT.west) / tileWidthMeters));
  const minTopRow = Math.max(0, Math.floor((EWMRS_EXTENT.north - bounded.maxY) / tileHeightMeters));
  const maxTopRow = Math.min(tileInfo.rows - 1, Math.floor((EWMRS_EXTENT.north - bounded.minY) / tileHeightMeters));
  const mosaicWidth = tileInfo.cols * tileInfo.tile_size;
  const mosaicHeight = tileInfo.rows * tileInfo.tile_size;
  const tileComposites: sharp.OverlayOptions[] = [];
  const tileTasks = Array.from({ length: maxX - minX + 1 }, (_, ix) => minX + ix).flatMap((x) =>
    Array.from({ length: maxTopRow - minTopRow + 1 }, (_, iy) => minTopRow + iy).map(
      (topRow) => async (): Promise<void> => {
        const ewmrsY = tileInfo.rows - 1 - topRow;
        const input = await client.downloadTile(tileInfo.product, timestamp, x, ewmrsY);
        tileComposites.push({
          input,
          left: x * tileInfo.tile_size,
          top: topRow * tileInfo.tile_size
        });
      }
    )
  );

  await runWithConcurrency(tileTasks, 4);

  const mosaic = await sharp({
    create: {
      width: mosaicWidth,
      height: mosaicHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(tileComposites)
    .png()
    .toBuffer();

  const extractLeft = Math.max(0, Math.floor(((bounded.minX - EWMRS_EXTENT.west) / (EWMRS_EXTENT.east - EWMRS_EXTENT.west)) * mosaicWidth));
  const extractTop = Math.max(0, Math.floor(((EWMRS_EXTENT.north - bounded.maxY) / (EWMRS_EXTENT.north - EWMRS_EXTENT.south)) * mosaicHeight));
  const extractRight = Math.min(mosaicWidth, Math.ceil(((bounded.maxX - EWMRS_EXTENT.west) / (EWMRS_EXTENT.east - EWMRS_EXTENT.west)) * mosaicWidth));
  const extractBottom = Math.min(mosaicHeight, Math.ceil(((EWMRS_EXTENT.north - bounded.minY) / (EWMRS_EXTENT.north - EWMRS_EXTENT.south)) * mosaicHeight));

  const extractedWidth = Math.max(1, extractRight - extractLeft);
  const extractedHeight = Math.max(1, extractBottom - extractTop);

  const extracted = await sharp(mosaic)
    .extract({
      left: extractLeft,
      top: extractTop,
      width: extractedWidth,
      height: extractedHeight
    })
    .resize({
      width: Math.max(1, Math.round((bounded.width / bounds.width) * width)),
      height: Math.max(1, Math.round((bounded.height / bounds.height) * height)),
      kernel: sharp.kernel.nearest,
      fastShrinkOnLoad: false
    })
    .png()
    .toBuffer();

  const [left, top] = mercatorToPixel(bounded.minX, bounded.maxY, bounds, width, height);
  const overlay = await clipOverlay(extracted, Math.round(left), Math.round(top), width, height);

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(overlay ? [{ ...overlay, blend: "screen" }] : [])
    .png()
    .toBuffer();
};

const createAlertOverlay = async (alert: AlertFeature, bounds: ViewportBounds, width: number, height: number): Promise<Buffer> => {
  const severity = alert.properties.severity.toLowerCase();
  const colors = severityColors[severity] ?? severityColors.moderate;
  const pathData = buildSvgPath(alert.geometry, bounds, width, height);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.55" />
        </filter>
      </defs>
      <path d="${pathData}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="4" filter="url(#shadow)" />
    </svg>`;

  return Buffer.from(svg);
};

const createMapComposite = async (
  alert: AlertFeature,
  client: EwmrsClient,
  tileInfo: TileInfo,
  timestamp: string,
  width: number,
  height: number,
  paddingRatio: number
): Promise<Buffer> => {
  const baseBounds = getMercatorBoundsForGeometry(alert.geometry);
  const viewport = expandBoundsToAspect(baseBounds, width, height, paddingRatio);
  const basemap = await createBasemap(viewport, width, height);
  const radar = await applyOpacity(await createRadarOverlay(client, tileInfo, timestamp, viewport, width, height), 0.35);
  const boundaryOverlay = await createBoundaryOverlay(viewport, width, height);
  const referenceOverlay = await createReferenceOverlay(viewport, width, height);
  const alertOverlay = await createAlertOverlay(alert, viewport, width, height);

  return sharp(basemap)
    .composite([
      { input: radar, blend: "over" },
      ...(boundaryOverlay ? [{ input: boundaryOverlay, blend: "over" as const }] : []),
      ...(referenceOverlay ? [{ input: referenceOverlay, blend: "over" as const }] : []),
      { input: alertOverlay, blend: "over" }
    ])
    .png()
    .toBuffer();
};

const composeAlertCard = async (mapImage: Buffer, alert: AlertFeature, width: number): Promise<Buffer> => {
  const outerPadding = Math.max(14, Math.round(width * 0.014));
  const innerPadding = Math.max(18, Math.round(width * 0.018));
  const cardWidth = width;
  const titleBarHeight = Math.max(92, Math.round(width * 0.11));
  const contentTop = Math.round(outerPadding + titleBarHeight + innerPadding * 0.75);
  const contentWidth = cardWidth - outerPadding * 2;
  const railWidth = Math.round(contentWidth * 0.33);
  const mapWidth = contentWidth - railWidth - innerPadding;
  const mapHeight = Math.round(mapWidth * 1.02);
  const expiryLines = wrapText(formatExpiry(alert.properties.expires), 18, 2);
  const expiryFontSize = Math.max(24, Math.round(width * 0.026));
  const expiryLineHeight = Math.round(expiryFontSize * 1.08);
  const validBlockHeight = 38 + expiryLineHeight * expiryLines.length + 30;
  const railHeight = validBlockHeight + 20;
  const cardHeight = Math.round(
    Math.max(contentTop + Math.max(railHeight, mapHeight) + outerPadding, Math.round(width * 0.81))
  );
  const severityKey = alert.properties.severity.toLowerCase();
  const accent = severityColors[severityKey]?.stroke ?? severityColors.moderate.stroke;
  const titleLines = wrapText(alert.properties.event, Math.max(24, Math.floor(contentWidth / 20)), 2);
  const validUntil = formatSectionDate(alert.properties.expires);
  const titleFontSize = Math.max(34, Math.round(width * 0.052));
  const titleLineHeight = Math.round(titleFontSize * 1.06);
  const sectionLabelSize = Math.max(13, Math.round(width * 0.014));
  const smallBodySize = Math.max(13, Math.round(width * 0.014));

  const mapPanel = await sharp(mapImage)
    .resize({ width: mapWidth, height: mapHeight, fit: "cover", position: "centre" })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${mapWidth}" height="${mapHeight}" viewBox="0 0 ${mapWidth} ${mapHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${mapWidth}" height="${mapHeight}" rx="28" ry="28" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/><rect x="18" y="18" width="${mapWidth - 36}" height="${mapHeight - 36}" rx="20" ry="20" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/></svg>`
        ),
        blend: "over"
      }
    ])
    .png()
    .toBuffer();

  const titleSvg = Buffer.from(`
    <svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="titleBar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#df9561"/>
          <stop offset="50%" stop-color="#f0ab75"/>
          <stop offset="100%" stop-color="#d18654"/>
        </linearGradient>
        <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#18212b"/>
          <stop offset="100%" stop-color="#0f151b"/>
        </linearGradient>
        <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M 26 0 L 0 0 0 26" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="${cardWidth}" height="${cardHeight}" rx="28" ry="28" fill="url(#shell)"/>
      <rect width="${cardWidth}" height="${cardHeight}" rx="28" ry="28" fill="url(#grid)" opacity="0.55"/>
      <rect x="${outerPadding}" y="${outerPadding}" width="${contentWidth}" height="${titleBarHeight}" rx="24" ry="24" fill="url(#titleBar)"/>
      <rect x="${outerPadding}" y="${outerPadding}" width="${contentWidth}" height="${titleBarHeight}" rx="24" ry="24" fill="none" stroke="rgba(255,255,255,0.18)"/>
      <text x="${cardWidth / 2}" y="${outerPadding + 46}" fill="#fff6ef" font-size="${Math.max(16, Math.round(width * 0.014))}" text-anchor="middle" letter-spacing="4.5" font-family="DejaVu Sans, sans-serif" font-weight="700">WEATHER ALERT BULLETIN</text>
      ${titleLines
        .map(
          (line, index) =>
            `<text x="${cardWidth / 2}" y="${outerPadding + 52 + titleFontSize + index * titleLineHeight}" fill="#fff9f3" font-size="${titleFontSize}" text-anchor="middle" font-family="Georgia, Times New Roman, serif" font-weight="700">${escapeXml(line)}</text>`
        )
        .join("")}
      <rect x="${outerPadding}" y="${contentTop}" width="${railWidth}" height="${railHeight}" rx="24" ry="24" fill="${PANEL_BACKGROUND}"/>
      <rect x="${outerPadding}" y="${contentTop}" width="${railWidth}" height="${railHeight}" rx="24" ry="24" fill="none" stroke="${PANEL_BORDER}"/>
      <rect x="${outerPadding + railWidth + innerPadding}" y="${contentTop}" width="${mapWidth}" height="${mapHeight}" rx="28" ry="28" fill="${MAP_FRAME}"/>
      <rect x="${outerPadding + railWidth + innerPadding}" y="${contentTop}" width="${mapWidth}" height="${mapHeight}" rx="28" ry="28" fill="none" stroke="rgba(255,255,255,0.08)"/>
      <text x="${outerPadding + 22}" y="${contentTop + 28}" fill="${SUBTLE_TEXT}" font-size="${sectionLabelSize}" letter-spacing="2.6" font-family="DejaVu Sans, sans-serif" font-weight="700">VALID UNTIL</text>
      ${expiryLines
        .map(
          (line, index) =>
            `<text x="${outerPadding + 22}" y="${contentTop + 32 + expiryFontSize + index * expiryLineHeight}" fill="${TITLE_COLOR}" font-size="${expiryFontSize}" font-family="Georgia, Times New Roman, serif" font-weight="700">${escapeXml(line)}</text>`
        )
        .join("")}
      <text x="${outerPadding + railWidth + innerPadding + 24}" y="${contentTop + 32}" fill="${SUBTLE_TEXT}" font-size="${sectionLabelSize}" letter-spacing="2.4" font-family="DejaVu Sans, sans-serif" font-weight="700">LIVE ALERT FOOTPRINT</text>
      <rect x="${outerPadding + railWidth + innerPadding + 24}" y="${contentTop + mapHeight - 78}" width="246" height="46" rx="14" ry="14" fill="rgba(8,11,15,0.56)" stroke="rgba(255,255,255,0.08)"/>
      <text x="${outerPadding + railWidth + innerPadding + 42}" y="${contentTop + mapHeight - 49}" fill="${TITLE_COLOR}" font-size="${smallBodySize}" font-family="DejaVu Sans, sans-serif" font-weight="700">Expires ${escapeXml(validUntil)}</text>
      <rect x="${outerPadding + 22}" y="${contentTop + railHeight - 12}" width="${railWidth - 44}" height="3" rx="2" ry="2" fill="${accent}" opacity="0.9"/>
    </svg>
  `);

  return sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 4,
      background: MOBILE_BACKGROUND
    }
  })
    .composite([
      { input: titleSvg, left: 0, top: 0 },
      { input: mapPanel, left: outerPadding + railWidth + innerPadding, top: contentTop }
    ])
    .png()
    .toBuffer();
};

export const renderComposite = async (
  alert: AlertFeature,
  client: EwmrsClient,
  tileInfo: TileInfo,
  timestamp: string,
  options: RenderOptions,
  outputPath?: string
): Promise<string> => {
  // Use the exact timestamp string selected upstream for every tile request.
  // The EWMRS tile API expects `YYYYMMDD-HHMMSS`, not ISO 8601.
  const canonicalTimestamp = timestamp;
  const outerPadding = Math.max(14, Math.round(options.width * 0.014));
  const innerPadding = Math.max(18, Math.round(options.width * 0.018));
  const contentWidth = options.width - outerPadding * 2;
  const railWidth = Math.round(contentWidth * 0.33);
  const mainMapWidth = contentWidth - railWidth - innerPadding;
  const mainMapHeight = Math.round(mainMapWidth * 1.02);

  const compositeMap = await createMapComposite(
    alert,
    client,
    tileInfo,
    canonicalTimestamp,
    mainMapWidth,
    mainMapHeight,
    0.28
  );

  await fs.mkdir(options.outputDir, { recursive: true });

  const slug = slugify(alert.properties.event);
  const finalOutputPath = outputPath ?? path.join(options.outputDir, `${slug}-${timestamp}.png`);
  await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });

  const mobileCard = await composeAlertCard(
    compositeMap,
    alert,
    options.width
  );

  await sharp(mobileCard).png().toFile(finalOutputPath);

  return finalOutputPath;
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
