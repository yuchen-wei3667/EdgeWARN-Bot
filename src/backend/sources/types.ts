export interface AlertSummary {
  id: string;
  name: string;
  urn_oid: string;
  effective: string;
  expires: string;
  severity: string;
  geometry: GeoPolygon;
}

export interface GeoPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface AlertFeature {
  id: string;
  type: string;
  geometry: GeoPolygon;
  properties: {
    id: string;
    areaDesc: string;
    sent: string;
    effective: string;
    onset?: string;
    expires: string;
    ends?: string;
    status: string;
    messageType: string;
    category: string;
    severity: string;
    certainty: string;
    urgency: string;
    event: string;
    senderName: string;
    headline: string;
    description: string;
  };
}

export interface TileInfo {
  product: string;
  rows: number;
  cols: number;
  tile_size: number;
  timestamps: string[];
}

export interface Place {
  /** Display name, such as "Oklahoma City, OK". Filled in from the NWS when missing. */
  label?: string;
  latitude: number;
  longitude: number;
}

export interface HourlyPoint {
  /** Local time, YYYY-MM-DDTHH:mm. */
  time: string;
  temperature: number;
  precipChance: number;
  /** NWS short forecast text, such as "Mostly Sunny". */
  shortForecast: string;
  isDaytime: boolean;
  /** Sustained wind in mph. When the NWS gives a range, the top of the range. */
  windSpeed: number;
  /** Compass abbreviation, such as "SSW". */
  windDirection: string;
  /** Gust in mph, never lower than the sustained wind. */
  gust: number;
}

export interface NwsForecast {
  timezone: string;
  /** "City, ST" of the NWS grid point's nearest town. */
  locationLabel: string;
  hourly: HourlyPoint[];
}
