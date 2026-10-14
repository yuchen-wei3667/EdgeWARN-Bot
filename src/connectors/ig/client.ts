import { InstagramApiError, type PublishResult } from "./types.js";

export interface InstagramConfig {
  accessToken?: string;
  userId?: string;
}

const GRAPH_BASE = "https://graph.instagram.com";
const API_VERSION = "v23.0";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Publishes images to Instagram as feed posts or stories, through the Instagram Graph API (Instagram Login). */
export class InstagramClient {
  constructor(private readonly settings: InstagramConfig) {}

  /** Posts an image to the feed. The URL must be a public HTTPS JPEG. */
  postImage(options: { imageUrl: string; caption?: string }): Promise<PublishResult> {
    return this.publish("feed", { image_url: options.imageUrl, ...(options.caption ? { caption: options.caption } : {}) });
  }

  /** Posts an image as a story. Stories do not take captions. */
  postStory(options: { imageUrl: string }): Promise<PublishResult> {
    return this.publish("story", { image_url: options.imageUrl, media_type: "STORIES" });
  }

  /** Extends the long-lived token by another 60 days. It must be at least 24 hours old. */
  async refreshToken(): Promise<{ accessToken: string; expiresIn: number }> {
    const { access_token, expires_in } = await this.request<{ access_token: string; expires_in: number }>(
      "GET",
      "/refresh_access_token",
      { grant_type: "ig_refresh_token" },
      false
    );
    return { accessToken: access_token, expiresIn: expires_in };
  }

  private async publish(kind: PublishResult["kind"], params: Record<string, string>): Promise<PublishResult> {
    const userId = this.require(this.settings.userId, "IG_USER_ID");
    if (!/^https:\/\//.test(params.image_url)) {
      throw new Error("Instagram needs a public HTTPS image URL. Set PUBLIC_BASE_URL to your server's HTTPS address.");
    }

    const { id: containerId } = await this.request<{ id: string }>("POST", `/${userId}/media`, params);
    await this.waitForContainer(containerId);
    // Not retried: a retry after a timeout could post the same image twice.
    const { id: mediaId } = await this.request<{ id: string }>("POST", `/${userId}/media_publish`, {
      creation_id: containerId
    });

    const { permalink } = await this.request<{ permalink?: string }>("GET", `/${mediaId}`, { fields: "permalink" }).catch(
      () => ({ permalink: undefined })
    );
    return { kind, mediaId, permalink };
  }

  private async waitForContainer(containerId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { status_code, status } = await this.request<{ status_code: string; status?: string }>(
        "GET",
        `/${containerId}`,
        { fields: "status_code,status" }
      );
      if (status_code === "FINISHED") return;
      if (status_code === "ERROR" || status_code === "EXPIRED") {
        throw new InstagramApiError(`Instagram could not process the image (${status_code}${status ? `: ${status}` : ""}).`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new InstagramApiError("Timed out waiting for Instagram to process the image.");
  }

  private require(value: string | undefined, name: string): string {
    if (!value) throw new Error(`${name} is not set. See .env.example.`);
    return value;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    versioned = true
  ): Promise<T> {
    const token = this.require(this.settings.accessToken, "IG_ACCESS_TOKEN");
    const url = new URL(`${versioned ? `/${API_VERSION}` : ""}${path}`, GRAPH_BASE);
    const body = new URLSearchParams({ ...params, access_token: token });
    if (method === "GET") url.search = body.toString();

    const response = await fetch(url, method === "POST" ? { method, body } : { method });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: number };
    };
    if (!response.ok || data.error) {
      const { message, code } = data.error ?? {};
      throw new InstagramApiError(
        `Instagram API ${method} ${path} failed: ${message ?? `${response.status} ${response.statusText}`}${code ? ` (code ${code})` : ""}`,
        code,
        response.status
      );
    }
    return data;
  }
}
