import test from "node:test";
import assert from "node:assert/strict";
import { TikTokDisplayClient, normalizeTikTokVideos } from "../src/tiktok-display.js";

test("TikTok video normalization keeps supported metadata and ignores invalid items", () => {
  const videos = normalizeTikTokVideos([
    {
      id: "123",
      create_time: 1700000000,
      title: "Title",
      video_description: "Description",
      share_url: "https://www.tiktok.com/@demo/video/123",
      embed_link: "https://www.tiktok.com/player/v1/123",
      cover_image_url: "https://cdn.example/cover.jpg",
      duration: 42
    },
    null,
    { title: "missing id" }
  ]);

  assert.deepEqual(videos, [{
    id: "123",
    createTime: 1700000000,
    title: "Title",
    description: "Description",
    shareUrl: "https://www.tiktok.com/@demo/video/123",
    embedLink: "https://www.tiktok.com/player/v1/123",
    coverImageUrl: "https://cdn.example/cover.jpg",
    duration: 42
  }]);
});

test("TikTok Display client refreshes an expiring access token before listing videos", async () => {
  const calls: Array<{ url: string; method?: string; authorization?: string }> = [];
  const client = new TikTokDisplayClient(async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      authorization: init?.headers && "Authorization" in init.headers
        ? String((init.headers as Record<string, unknown>).Authorization)
        : undefined
    });

    if (url.endsWith("/v2/oauth/token/")) {
      return new Response(JSON.stringify({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        open_id: "open-123",
        expires_in: 86400,
        refresh_expires_in: 31536000,
        scope: "user.info.basic,video.list"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({
      data: {
        videos: [{ id: "video-1", create_time: 1700000000, title: "Latest", share_url: "https://www.tiktok.com/@demo/video/video-1" }],
        cursor: 1700000000000,
        has_more: false
      },
      error: { code: "ok" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  let persisted: any = null;
  const result = await client.listRecentVideos({
    clientId: "client-key",
    clientSecret: "client-secret",
    accessToken: "stale-access",
    refreshToken: "old-refresh",
    expiresAt: Date.now() + 60_000,
    refreshExpiresAt: Date.now() + 3600_000
  }, {
    persist: async (credential) => { persisted = credential; }
  });

  assert.equal(result.videos[0]?.id, "video-1");
  assert.equal(persisted.accessToken, "fresh-access");
  assert.equal(persisted.refreshToken, "fresh-refresh");
  assert.equal(persisted.openId, "open-123");
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[1]?.authorization ?? "", /fresh-access/);
});
