export type MediaKind = "feed" | "story";

export interface PublishResult {
  kind: MediaKind;
  mediaId: string;
  permalink?: string;
}

/** An error response from the Instagram Graph API. Code 190 means the access token expired. */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}
