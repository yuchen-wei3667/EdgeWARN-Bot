import { AlertFeature, AlertSummary } from "./types.js";

export class EdgeWarnClient {
  constructor(private readonly baseUrl: string) {}

  async getAlertTimestamps(): Promise<string[]> {
    const url = new URL("/api/v2/features/alerts/official", this.baseUrl);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch alert timestamps: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as string[];
  }

  async getAlerts(timestamp: string): Promise<AlertSummary[]> {
    const url = new URL("/api/v2/features/alerts/official", this.baseUrl);
    url.searchParams.set("timestamp", timestamp);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch alerts for ${timestamp}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AlertSummary[];
  }

  async getAlertById(id: string): Promise<AlertFeature> {
    const url = new URL("/api/v2/features/alerts/official", this.baseUrl);
    url.searchParams.set("id", id);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch alert ${id}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AlertFeature;
  }
}
