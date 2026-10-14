import { config } from "../../config.js";
import { InstagramClient } from "./client.js";
import type { MediaKind, PublishResult } from "./types.js";

export { InstagramClient } from "./client.js";
export * from "./types.js";

export const createInstagramClient = (): InstagramClient =>
  new InstagramClient({
    accessToken: config.igAccessToken,
    userId: config.igUserId
  });

/** Publishes an already-public image URL as a feed post or a story. Captions apply to feed posts only. */
export const publishImage = (kind: MediaKind, imageUrl: string, caption?: string): Promise<PublishResult> => {
  const client = createInstagramClient();
  return kind === "story" ? client.postStory({ imageUrl }) : client.postImage({ imageUrl, caption });
};
