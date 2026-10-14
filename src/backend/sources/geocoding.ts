import type { Place } from "./types.js";

const USPS: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI",
  Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC"
};

/** Turns a place name into coordinates. This uses Open-Meteo's free geocoder. */
export class GeocodingClient {
  constructor(private readonly baseUrl: string) {}

  async findPlace(query: string): Promise<Place> {
    const [name, region] = query.split(",").map((part) => part.trim());
    const url = new URL("/v1/search", this.baseUrl);
    url.searchParams.set("name", name);
    url.searchParams.set("count", "10");
    url.searchParams.set("country_code", "US");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to look up "${query}": ${response.status} ${response.statusText}`);
    }

    const { results = [] } = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const wanted = region?.toLowerCase();
    const match =
      results.find((r) => wanted && (String(r.admin1 ?? "").toLowerCase() === wanted || USPS[String(r.admin1)]?.toLowerCase() === wanted)) ??
      results[0];

    if (!match) {
      throw new Error(`No place found for "${query}". Try a city name, or pass --lat and --lon.`);
    }

    const state = match.admin1 ? (USPS[String(match.admin1)] ?? String(match.admin1)) : undefined;
    return {
      label: state ? `${match.name}, ${state}` : String(match.name),
      latitude: Number(match.latitude),
      longitude: Number(match.longitude)
    };
  }
}
