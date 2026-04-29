// Cloudflare Worker entrypoint.
//
// Triggered by a Cron Trigger (every 5 min). Delegates to run.ts for all
// bot logic; this file only provides the KV-backed HandledStore adapter and
// the Worker fetch/scheduled handlers.

import { runOnce, type HandledStore } from "./run";

export interface Env {
  BSKY_HANDLE: string;
  BSKY_APP_PASSWORD: string;
  FEED_URL?: string;
  STATE: KVNamespace;
  MAX_POSTS_PER_RUN?: string;
  BOOTSTRAP_SILENT?: string;
  TRIGGER_SECRET?: string;
}

function parseMaxPosts(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HANDLED_KEY = "lastHandledAt";

function kvStore(kv: KVNamespace): HandledStore {
  return {
    async getLastHandledAt() {
      const val = await kv.get(HANDLED_KEY);
      return val ? Number(val) : null;
    },
    async setLastHandledAt(value: number) {
      await kv.put(HANDLED_KEY, String(value));
    },
  };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOnce(kvStore(env.STATE), {
      feedUrl: env.FEED_URL,
      maxPosts: parseMaxPosts(env.MAX_POSTS_PER_RUN, 3),
      bootstrapSilent: (env.BOOTSTRAP_SILENT ?? "true") !== "false",
      bskyHandle: env.BSKY_HANDLE,
      bskyPassword: env.BSKY_APP_PASSWORD,
    }, (m) => console.log(m)).catch((err) => console.error(`scheduled run failed: ${(err as Error).message}`)));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run" && env.TRIGGER_SECRET && url.searchParams.get("key") === env.TRIGGER_SECRET) {
      const logs: string[] = [];
      try {
        await runOnce(kvStore(env.STATE), {
          feedUrl: env.FEED_URL,
          maxPosts: parseMaxPosts(env.MAX_POSTS_PER_RUN, 3),
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
