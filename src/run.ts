// Shared bot logic. Both worker.ts and node-entry.ts delegate here.
//
// The only difference between the two deployments is state storage:
// worker.ts uses KV, node-entry.ts uses a JSON file. Callers provide
// a thin SeenStore adapter and this module handles the rest.

import { fetchAlerts, FEED_URL as DEFAULT_FEED_URL, alertUrl } from "./scrape";
import type { Alert } from "./scrape";
import { classify, CATEGORIES } from "./filter";
import { login, buildPost, createPost } from "./bsky";

export interface SeenStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface RunConfig {
  feedUrl?: string;
  maxPosts: number;
  bootstrapSilent: boolean;
  bskyHandle: string;
  bskyPassword: string;
}

const BOOTSTRAP_KEY = "__bootstrapped__";

export async function runOnce(
  store: SeenStore,
  config: RunConfig,
  log: (msg: string) => void,
): Promise<void> {
  const feedUrl = config.feedUrl || DEFAULT_FEED_URL;

  log(`fetching ${feedUrl}`);
  const alerts = await fetchAlerts(feedUrl);
  log(`parsed ${alerts.length} alerts`);

  // Detect first run.
  const bootstrapped = await store.get(BOOTSTRAP_KEY);
  if (!bootstrapped && config.bootstrapSilent) {
    log(`bootstrap: marking ${alerts.length} existing alerts as seen without posting`);
    for (const a of alerts) {
      await store.put(`alert:${a.id}`, "bootstrap");
    }
    await store.put(BOOTSTRAP_KEY, new Date().toISOString());
    return;
  }

  // Determine which are new and postable.
  const toPost: { alert: Alert; category: string }[] = [];
  for (const alert of alerts) {
    const key = `alert:${alert.id}`;
    if (await store.get(key)) continue;

    const decision = classify(alert);
    if (decision.kind === "drop") {
      await store.put(key, `dropped:${decision.reason}`);
      log(`drop ${alert.id}: ${decision.reason}`);
      continue;
    }
    toPost.push({ alert, category: decision.category });
  }
  log(`${toPost.length} alerts to post`);
  if (toPost.length === 0) return;

  // API returns newest-first; reverse for chronological posting order.
  toPost.reverse();

  const batch = toPost.slice(0, config.maxPosts);
  if (toPost.length > config.maxPosts) {
    log(`capping at ${config.maxPosts}; ${toPost.length - config.maxPosts} marked seen-but-skipped`);
    for (const item of toPost.slice(config.maxPosts)) {
      await store.put(`alert:${item.alert.id}`, "skipped:rate-cap");
    }
  }

  const session = await login(config.bskyHandle, config.bskyPassword);
  log(`bsky session as ${session.handle}`);

  for (const { alert, category } of batch) {
    const prefix = CATEGORIES[category] || CATEGORIES.other;
    const text = (alert.body || alert.title).replace(/^\[AlertDC\]\s*/, "");
    const built = buildPost(text, alertUrl(alert.id), prefix);
    try {
      await createPost(session, built);
      await store.put(`alert:${alert.id}`, `posted:${category}`);
      log(`posted ${alert.id} [${category}]`);
    } catch (err) {
      log(`post failed for ${alert.id}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
