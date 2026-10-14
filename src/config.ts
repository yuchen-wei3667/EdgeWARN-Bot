import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  nwsApi: process.env.NWS_API ?? "https://api.weather.gov",
  // The NWS asks every client to identify itself. Add a contact URL or email through the environment.
  nwsUserAgent: process.env.NWS_USER_AGENT ?? "EdgeWARN-Bot (github.com/yuchen-wei3667/EdgeWARN-Bot)",
  geocodingApi: process.env.GEOCODING_API ?? "https://geocoding-api.open-meteo.com",
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "output"),
  serverHost: process.env.SERVER_HOST ?? "0.0.0.0",
  serverPort: toPositiveInt(process.env.SERVER_PORT, 6767)
} as const;
