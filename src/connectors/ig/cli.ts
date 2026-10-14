import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { resolveForecastImage } from "../../backend/forecast/index.js";
import { GeocodingClient } from "../../backend/sources/geocoding.js";
import { publishImage } from "./index.js";
import type { MediaKind } from "./types.js";

const printUsage = (): void => {
  console.log(`Usage: npm run ig -- --kind feed|story --image-url <https url> [--caption <text>]
       npm run ig -- --kind feed|story --forecast "Oklahoma City, OK" [--caption <text>]

--forecast renders the forecast as a JPEG into the output directory, then publishes it from PUBLIC_BASE_URL/media/.
The server (npm run server:dev) must be running and reachable at PUBLIC_BASE_URL while Instagram fetches the image.`);
};

const parseArgs = (argv: string[]): Record<string, string> => {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (!["--kind", "--image-url", "--caption", "--forecast"].includes(arg) || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    options[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  if (options.kind !== "feed" && options.kind !== "story") throw new Error("Pass --kind feed or --kind story.");
  const kind: MediaKind = options.kind;
  if (options.caption && kind === "story") console.warn("Stories do not take captions, so --caption is ignored.");

  let imageUrl = options["image-url"];
  if (options.forecast) {
    if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL is not set. See .env.example.");
    const jpeg = await resolveForecastImage(
      { geocoding: new GeocodingClient(config.geocodingApi) },
      { place: options.forecast },
      // Feed posts must be between 4:5 and 1.91:1, and stories are 9:16.
      { format: "jpeg", aspect: kind === "story" ? 9 / 16 : 4 / 5 }
    );
    const today = new Intl.DateTimeFormat("en-CA").format(new Date());
    const name = `forecast-${kind}-${today}-${Date.now()}.jpg`;
    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.writeFile(path.join(config.outputDir, name), jpeg);
    imageUrl = new URL(`/media/${name}`, config.publicBaseUrl).href;
    console.log(`Rendered ${imageUrl}`);
  }
  if (!imageUrl) throw new Error("Pass --image-url or --forecast.");

  const result = await publishImage(kind, imageUrl, options.caption);
  console.log(`Published ${result.kind}: ${result.mediaId}${result.permalink ? ` ${result.permalink}` : ""}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
