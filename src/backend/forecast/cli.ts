import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { GeocodingClient } from "../sources/geocoding.js";
import { fetchDailyCard } from "./automation.js";
import { resolvePlace } from "./index.js";

const printUsage = (): void => {
  console.log(`Usage: npm run forecast -- --place "Oklahoma City, OK" [--school on|off] [--scroll] [--output <file.png>]
       npm run forecast -- --lat <lat> --lon <lon> [--school on|off] [--scroll] [--output <file.png>]`);
};

const parseArgs = (argv: string[]): Record<string, string> => {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--scroll") {
      options.scroll = "on";
      continue;
    }
    if (!["--place", "--lat", "--lon", "--name", "--school", "--output"].includes(arg) || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    options[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const place = await resolvePlace(
    { geocoding: new GeocodingClient(config.geocodingApi) },
    {
      place: options.place,
      lat: options.lat === undefined ? undefined : Number(options.lat),
      lon: options.lon === undefined ? undefined : Number(options.lon),
      name: options.name
    }
  );
  const png = await fetchDailyCard(place, { school: options.school, scroll: options.scroll !== undefined });

  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const output = options.output
    ? path.resolve(process.cwd(), options.output)
    : path.join(config.outputDir, `forecast-${today}.png`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, png);

  console.log(`Generated daily forecast image: ${output}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate forecast: ${message}`);
  process.exit(1);
});
