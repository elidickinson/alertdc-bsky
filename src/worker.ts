// Cloudflare Worker entrypoint.
//
// Triggered by a Cron Trigger (every 5 min). Delegates to run.ts for all
// bot logic; this file only provides the KV-backed SeenStore adapter and
// the Worker fetch/scheduled handlers.

import { runOnce, type SeenStore, type RunConfig } from "./run";

export interface Env {
  BSKY_HANDLE: string;
  BSKY_APP_PASSWORD: string;
  FEED_URL?: string;
  SEEN: KVNamespace;
  MAX_POSTS_PER_RUN?: string;
  BOOTSTRAP_SILENT?: string;
  TRIGGER_SECRET?: string;
}

const SEEN_TTL = 60 * 60 * 24 * 30;

function kvStore(kv: KVNamespace): SeenStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value) => kv.put(key, value, { expirationTtl: SEEN_TTL }),
  };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOnce(kvStore(env.SEEN), {
      feedUrl: env.FEED_URL,
      maxPosts: env.MAX_POSTS_PER_RUN ? parseInt(env.MAX_POSTS_PER_RUN, 10) : 10,
      bootstrapSilent: (env.BOOTSTRAP_SILENT ?? "true") !== "false",
      bskyHandle: env.BSKY_HANDLE,
      bskyPassword: env.BSKY_APP_PASSWORD,
    }, (m) => console.log(m)));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run" && env.TRIGGER_SECRET && url.searchParams.get("key") === env.TRIGGER_SECRET) {
      const logs: string[] = [];
      try {
        await runOnce(kvStore(env.SEEN), {
          feedUrl: env.FEED_URL,
          maxPosts: env.MAX_POSTS_PER_RUN ? parseInt(env.MAX_POSTS_PER_RUN, 10) : 10,
          bootstrapSilent: (env.BOOTSTRAP_SILENT ?? "true") !== "false",
          bskyHandle: env.BSKY_HANDLE,
          bskyPassword: env.BSKY_APP_PASSWORD,
        }, (m) => logs.push(m));
        return new Response(logs.join("\n") + "\nOK\n", { status: 200 });
      } catch (err) {
        logs.push(`ERROR: ${(err as Error).message}`);
        return new Response(logs.join("\n"), { status: 500 });
      }
    }
    return new Response("alertdc-bsky bot is alive\n", { status: 200 });
  },
};
