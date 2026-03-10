import fs from "node:fs/promises";
import path from "node:path";
import { tileConfig } from "../../config.js";
import { TileInfo } from "./types.js";

export class EwmrsClient {
  private readonly inflightTiles = new Map<string, Promise<Buffer>>();

  constructor(private readonly baseUrl: string) {}

  private getTileCachePath(product: string, timestamp: string, x: number, y: number): string {
    return path.join(tileConfig.cacheDir, "ewmrs", product, timestamp, String(x), `${y}.png`);
  }

  private async readCachedTile(product: string, timestamp: string, x: number, y: number): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.getTileCachePath(product, timestamp, x, y));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private async writeCachedTile(product: string, timestamp: string, x: number, y: number, data: Buffer): Promise<void> {
    const filePath = this.getTileCachePath(product, timestamp, x, y);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  private async fetchTileWithRetry(url: URL, cacheKey: string): Promise<Buffer> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(url);

      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
        const waitMs = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : 800 * 2 ** attempt + Math.round(Math.random() * 250);

        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      throw new Error(`Failed to fetch tile ${cacheKey}: ${response.status} ${response.statusText}`);
    }

    throw new Error(`Failed to fetch tile ${cacheKey}`);
  }

  async getProducts(): Promise<string[]> {
    const url = new URL("/renders/get-items", this.baseUrl);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch EWMRS products: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as string[];
  }

  async getTimestamps(product: string): Promise<string[]> {
    const url = new URL("/renders/fetch", this.baseUrl);
    url.searchParams.set("product", product);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch timestamps for ${product}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as string[];
  }

  async getTileInfo(product: string): Promise<TileInfo> {
    const url = new URL("/renders/tile-info", this.baseUrl);
    url.searchParams.set("product", product);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch tile info for ${product}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TileInfo;
  }

  async downloadTile(product: string, timestamp: string, x: number, y: number): Promise<Buffer> {
    const cached = await this.readCachedTile(product, timestamp, x, y);
    if (cached) {
      return cached;
    }

    const cacheKey = `${product}/${timestamp}/${x}/${y}`;
    const existing = this.inflightTiles.get(cacheKey);
    if (existing) {
      return existing;
    }

    const url = new URL("/renders/tile", this.baseUrl);
    url.searchParams.set("product", product);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("x", String(x));
    url.searchParams.set("y", String(y));

    const request = this.fetchTileWithRetry(url, cacheKey)
      .then(async (buffer) => {
        await this.writeCachedTile(product, timestamp, x, y, buffer);
        return buffer;
      })
      .finally(() => {
        this.inflightTiles.delete(cacheKey);
      });

    this.inflightTiles.set(cacheKey, request);
    return request;
  }
}
