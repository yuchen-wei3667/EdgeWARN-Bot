import type { GeoPolygon } from "./sources/types.js";
import type { Position, ViewportBounds } from "./types.js";

export const WEB_MERCATOR_LIMIT = 20037508.342789244;
export const EWMRS_EXTENT = {
  west: -14471533.8,
  east: -6679169.5,
  south: 2273030.9,
  north: 7361866.1
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export const lonLatToMercator = ([lon, lat]: Position): Position => {
  const x = (lon * WEB_MERCATOR_LIMIT) / 180;
  const clampedLat = clamp(lat, -85.05112878, 85.05112878);
  const y = Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) / (Math.PI / 180);
  return [x, (y * WEB_MERCATOR_LIMIT) / 180];
};

export const mercatorToPixel = (
  x: number,
  y: number,
  bounds: ViewportBounds,
  width: number,
  height: number
): Position => {
  const px = ((x - bounds.minX) / bounds.width) * width;
  const py = ((bounds.maxY - y) / bounds.height) * height;
  return [px, py];
};

export const getPolygonRings = (geometry: GeoPolygon): Position[][] => {
  if (geometry.type === "Polygon") {
    return geometry.coordinates as Position[][];
  }

  return (geometry.coordinates as Position[][][]).flat();
};

export const getMercatorBoundsForGeometry = (geometry: GeoPolygon): ViewportBounds => {
  const points = getPolygonRings(geometry).flat().map(lonLatToMercator);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
};

export const expandBoundsToAspect = (
  source: ViewportBounds,
  width: number,
  height: number,
  paddingRatio = 0.4
): ViewportBounds => {
  const targetAspect = width / height;
  const paddedWidth = Math.max(source.width * (1 + paddingRatio * 2), 50000);
  const paddedHeight = Math.max(source.height * (1 + paddingRatio * 2), 50000);
  const centerX = (source.minX + source.maxX) / 2;
  const centerY = (source.minY + source.maxY) / 2;

  let finalWidth = paddedWidth;
  let finalHeight = paddedHeight;

  if (finalWidth / finalHeight > targetAspect) {
    finalHeight = finalWidth / targetAspect;
  } else {
    finalWidth = finalHeight * targetAspect;
  }

  return {
    minX: centerX - finalWidth / 2,
    maxX: centerX + finalWidth / 2,
    minY: centerY - finalHeight / 2,
    maxY: centerY + finalHeight / 2,
    width: finalWidth,
    height: finalHeight
  };
};

export const buildSvgPath = (geometry: GeoPolygon, bounds: ViewportBounds, width: number, height: number): string => {
  const rings = getPolygonRings(geometry);
  return rings
    .map((ring) => {
      const commands = ring
        .map((point, index) => {
          const [mx, my] = lonLatToMercator(point);
          const [px, py] = mercatorToPixel(mx, my, bounds, width, height);
          return `${index === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
        })
        .join(" ");
      return `${commands} Z`;
    })
    .join(" ");
};

export const mercatorToSlippyTile = (x: number, y: number, zoom: number): { x: number; y: number } => {
  // Convert Web Mercator meters to slippy tile coordinates.
  // Standard formula: tileX = floor(((x + limit) / (2*limit)) * 2^zoom)
  // and tileY = floor(((limit - y) / (2*limit)) * 2^zoom)
  const normX = (x + WEB_MERCATOR_LIMIT) / (2 * WEB_MERCATOR_LIMIT);
  const normY = (WEB_MERCATOR_LIMIT - y) / (2 * WEB_MERCATOR_LIMIT);
  const scale = 2 ** zoom;
  const tileX = Math.floor(normX * scale);
  const tileY = Math.floor(normY * scale);
  return { x: tileX, y: tileY };
};

export const slippyTileToMercatorBounds = (x: number, y: number, zoom: number) => {
  // Convert slippy tile X/Y/Z to lon/lat bounds, then to Web Mercator meters.
  const n = 2 ** zoom;
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latBottom = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;

  const [left, top] = lonLatToMercator([lonLeft, latTop]);
  const [right, bottom] = lonLatToMercator([lonRight, latBottom]);

  return {
    left,
    top,
    right,
    bottom
  };
};

export const viewportZoomLevel = (bounds: ViewportBounds, width: number, height: number): number => {
  for (let zoom = 18; zoom >= 0; zoom -= 1) {
    const metersPerPixel = (2 * WEB_MERCATOR_LIMIT) / (256 * 2 ** zoom);
    const requiredWidth = bounds.width / metersPerPixel;
    const requiredHeight = bounds.height / metersPerPixel;
    if (requiredWidth <= width * 1.5 && requiredHeight <= height * 1.5) {
      return zoom;
    }
  }

  return 0;
};
