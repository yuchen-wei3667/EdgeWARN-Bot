import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { GeocodingClient } from "../sources/geocoding.js";
import { NwsClient } from "../sources/nws.js";
import { resolveForecastImage } from "./index.js";
import { renderForecastImage } from "./render.js";
import { buildScenarios } from "./scenarios.js";

const printUsage = (): void => {
  console.log(`Usage: npm run forecast -- --place "Oklahoma City, OK" [--output <file.png>]
       npm run forecast -- --samples [--output <folder>]   (hazard previews from made-up data)
       npm run forecast -- --lat <lat> --lon <lon> [--name <label>] [--output <file.png>]`);
};

const parseArgs = (argv: string[]): Record<string, string> => {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--samples") {
      options.samples = "true";
      continue;
    }
    if (!["--place", "--lat", "--lon", "--name", "--output"].includes(arg) || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    options[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  if (options.samples) {
    const folder = path.resolve(process.cwd(), options.output ?? path.join(config.outputDir, "samples"));
    await fs.mkdir(folder, { recursive: true });
    for (const { id, forecast } of buildScenarios()) {
      const file = path.join(folder, `${id}.png`);
      await fs.writeFile(file, await renderForecastImage(forecast));
      console.log(`${id}: ${forecast.hazard?.level ?? "no hazard"} ${forecast.hazard?.label ?? ""} -> ${file}`);
    }
    return;
  }
  const clients = {
    nws: new NwsClient(config.nwsApi, config.nwsUserAgent),
    geocoding: new GeocodingClient(config.geocodingApi)
  };

  const { png, forecast } = await resolveForecastImage(clients, {
    place: options.place,
    lat: options.lat === undefined ? undefined : Number(options.lat),
    lon: options.lon === undefined ? undefined : Number(options.lon),
    name: options.name
  });

  const output = options.output
    ? path.resolve(process.cwd(), options.output)
    : path.join(config.outputDir, `forecast-${forecast.date}.png`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, png);

  console.log(`Generated daily forecast image: ${output}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate forecast: ${message}`);
  process.exit(1);
});
