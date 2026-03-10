import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  edgewarnApi: process.env.EDGEWARN_API ?? "https://api.edgewarn.ashk3000.com",
  ewmrsApi: process.env.EWMRS_API ?? "https://ewmrs.edgewarn.ashk3000.com",
  nwsApi: process.env.NWS_API ?? "https://api.weather.gov",
  // The NWS asks every client to identify itself. Add a contact URL or email through the environment.
  nwsUserAgent: process.env.NWS_USER_AGENT ?? "EdgeWARN-Bot (github.com/yuchen-wei3667/EdgeWARN-Bot)",
  geocodingApi: process.env.GEOCODING_API ?? "https://geocoding-api.open-meteo.com",
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "output"),
  defaultProduct: process.env.DEFAULT_PRODUCT ?? "CompRefQC",
  viewportWidth: toPositiveInt(process.env.VIEWPORT_WIDTH, 1080),
  viewportHeight: toPositiveInt(process.env.VIEWPORT_HEIGHT, 1080),
  serverHost: process.env.SERVER_HOST ?? "0.0.0.0",
  serverPort: toPositiveInt(process.env.SERVER_PORT, 6767)
} as const;

// Additional runtime tile settings (can be overridden via env vars)
export const tileConfig = {
  // Default to CartoDB Dark Matter with roads and place names so the alert context stays readable.
  urlTemplate: process.env.TILE_URL_TEMPLATE ?? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  // Optional administrative boundary reference layer for clearer state borders.
  boundaryUrlTemplate:
    process.env.TILE_BOUNDARY_URL_TEMPLATE ??
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  // Optional transparent reference layer for labels that should remain legible above radar imagery.
  referenceUrlTemplate: process.env.TILE_REFERENCE_URL_TEMPLATE ?? "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png",
  // Comma-separated subdomains, used for providers that support {s}
  subdomains: (process.env.TILE_SUBDOMAINS ?? "a,b,c").split(",").map((s) => s.trim()).filter(Boolean),
  // Local tile cache directory to avoid repeated requests and reduce provider load
  cacheDir: path.resolve(process.cwd(), process.env.TILE_CACHE_DIR ?? path.join(process.env.OUTPUT_DIR ?? "output", ".tilecache"))
} as const;
