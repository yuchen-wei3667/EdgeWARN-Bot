import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config } from "../config.js";
import { GeocodingClient } from "./sources/geocoding.js";
import { resolveForecastImage } from "./forecast/index.js";

const forecastClients = {
  geocoding: new GeocodingClient(config.geocodingApi)
};

const json = (body: unknown, statusCode = 200): string =>
  JSON.stringify(body, null, statusCode >= 400 ? 0 : 2);

const requestListener = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (method === "GET" && url.pathname === "/") {
    response.writeHead(200);
    response.end(
      json({
        ok: true,
        service: "edgewarn-bot-server",
        secure: false,
        port: config.serverPort,
        endpoints: ["/", "/health", "/forecast.png?place=<city, state>", "/media/<name>.jpg"]
      })
    );
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    response.writeHead(200);
    response.end(json({ ok: true }));
    return;
  }

  if (method === "GET" && url.pathname === "/forecast.png") {
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    try {
      const png = await resolveForecastImage(forecastClients, {
        place: url.searchParams.get("place") ?? undefined,
        lat: lat === null ? undefined : Number(lat),
        lon: lon === null ? undefined : Number(lon),
        name: url.searchParams.get("name") ?? undefined
      });
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "public, max-age=900");
      response.writeHead(200);
      response.end(png);
    } catch (error) {
      response.writeHead(400);
      response.end(json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400));
    }
    return;
  }

  // Serves generated JPEGs from the output directory so Instagram can fetch them by URL.
  const media = method === "GET" ? /^\/media\/([\w-]+(?:\.[\w-]+)*\.jpe?g)$/i.exec(url.pathname) : null;
  if (media) {
    try {
      const jpeg = await fs.readFile(path.join(config.outputDir, media[1]));
      response.setHeader("Content-Type", "image/jpeg");
      response.writeHead(200);
      response.end(jpeg);
      return;
    } catch {
      // Falls through to the 404 below.
    }
  }

  response.writeHead(404);
  response.end(json({ ok: false, error: "Not found" }, 404));
};

const main = async (): Promise<void> => {
  const server = http.createServer((request, response) => {
    void requestListener(request, response);
  });

  server.listen(config.serverPort, config.serverHost, () => {
    console.log(`HTTP server listening on http://${config.serverHost}:${config.serverPort}`);
  });
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start HTTP server: ${message}`);
  process.exit(1);
});
