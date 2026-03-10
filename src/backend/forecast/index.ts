import type { GeocodingClient } from "../sources/geocoding.js";
import type { NwsClient } from "../sources/nws.js";
import type { Place } from "../sources/types.js";
import { generateDailyForecast } from "./generate.js";
import { renderForecastImage } from "./render.js";
import type { DailyForecast } from "./types.js";

export interface ForecastRequest {
  place?: string;
  lat?: number;
  lon?: number;
  name?: string;
}

export interface ForecastClients {
  nws: NwsClient;
  geocoding: GeocodingClient;
}

const resolvePlace = async (clients: ForecastClients, request: ForecastRequest): Promise<Place> => {
  if (request.lat !== undefined || request.lon !== undefined) {
    const { lat, lon } = request;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Pass both --lat and --lon as numbers.");
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error("Latitude must be within 90 and longitude within 180.");
    }
    return { label: request.name, latitude: lat, longitude: lon };
  }

  if (!request.place) {
    throw new Error('Pass a place, such as --place "Oklahoma City, OK", or --lat and --lon.');
  }
  return clients.geocoding.findPlace(request.place);
};

/** Looks up the place, builds the forecast, and draws it. */
export const resolveForecastImage = async (
  clients: ForecastClients,
  request: ForecastRequest
): Promise<{ png: Buffer; forecast: DailyForecast }> => {
  const place = await resolvePlace(clients, request);
  const forecast = await generateDailyForecast(clients.nws, place);
  return { png: await renderForecastImage(forecast), forecast };
};
