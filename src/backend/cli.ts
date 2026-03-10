import path from "node:path";
import { config } from "../config.js";
import { EdgeWarnClient } from "./sources/edgewarn.js";
import { EwmrsClient } from "./sources/ewmrs.js";
import { renderComposite } from "./alerts/render.js";
import type { CliOptions } from "./types.js";

const printUsage = (): void => {
  console.log(`Usage: npm run dev -- [--alert-id <id>] [--timestamp <timestamp>] [--output <file.png>]`);
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--alert-id") {
      options.alertId = argv[index + 1];
      index += 1;
    } else if (arg === "--timestamp") {
      options.timestamp = argv[index + 1];
      index += 1;
    } else if (arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const parseCompactTimestamp = (value: string): number | null => {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
};

const pickClosestTimestamp = (reference: string, candidates: string[]): string => {
  const target = parseCompactTimestamp(reference);
  if (target === null || candidates.length === 0) {
    return candidates[0];
  }

  return candidates.reduce((best, current) => {
    const bestDistance = Math.abs((parseCompactTimestamp(best) ?? target) - target);
    const currentDistance = Math.abs((parseCompactTimestamp(current) ?? target) - target);
    return currentDistance < bestDistance ? current : best;
  });
};

const normalizeTileTimestamp = (value: string): string => {
  const compact = parseCompactTimestamp(value);
  if (compact !== null) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    const n = Number(value);
    const ms = value.length <= 10 ? n * 1000 : n;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      const second = String(date.getUTCSeconds()).padStart(2, "0");
      return `${year}${month}${day}-${hour}${minute}${second}`;
    }
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    const second = String(date.getUTCSeconds()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}${second}`;
  }

  throw new Error(`Unable to parse timestamp: ${value}`);
};

const main = async (): Promise<void> => {
  const cli = parseArgs(process.argv.slice(2));
  const edgewarn = new EdgeWarnClient(config.edgewarnApi);
  const ewmrs = new EwmrsClient(config.ewmrsApi);

  const availableTimestamps = await edgewarn.getAlertTimestamps();
  if (availableTimestamps.length === 0) {
    throw new Error("No alert timestamps returned by EdgeWARN API");
  }

  const alertTimestamp = cli.timestamp ?? availableTimestamps[0];
  const alerts = await edgewarn.getAlerts(alertTimestamp);
  if (alerts.length === 0) {
    throw new Error(`No alerts found for timestamp ${alertTimestamp}`);
  }

  const selectedAlert = cli.alertId
    ? alerts.find((alert) => alert.id === cli.alertId || alert.urn_oid === cli.alertId)
    : alerts[0];

  if (!selectedAlert) {
    throw new Error(`Alert ${cli.alertId} not found in timestamp ${alertTimestamp}`);
  }

  const fullAlert = await edgewarn.getAlertById(selectedAlert.id);
  const tileInfo = await ewmrs.getTileInfo(config.defaultProduct);
  const productTimestamp = pickClosestTimestamp(alertTimestamp, tileInfo.timestamps);

  if (!productTimestamp) {
    throw new Error(`No ${config.defaultProduct} timestamps returned by EWMRS API`);
  }

  const canonicalTimestamp = normalizeTileTimestamp(productTimestamp);

  const output = await renderComposite(
    fullAlert,
    ewmrs,
    tileInfo,
    canonicalTimestamp,
    {
      width: config.viewportWidth,
      height: config.viewportHeight,
      outputDir: config.outputDir,
      product: config.defaultProduct
    },
    cli.output ? path.resolve(process.cwd(), cli.output) : undefined
  );

  console.log(`Generated alert image: ${output}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate image: ${message}`);
  process.exit(1);
});
