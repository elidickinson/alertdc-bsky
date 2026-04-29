// Shared bot logic. Both worker.ts and node-entry.ts delegate here.
//
// The only difference between the two deployments is state storage:
// worker.ts uses KV, node-entry.ts uses a JSON file. Callers provide
// a thin HandledStore adapter and this module handles the rest.
//
// State is a single watermark: the sendDate of the last "handled" alert.
// An alert is handled when it's either dropped (by filter) or successfully
// posted. Rate-limited alerts are NOT handled — they're retried next run.

import { fetchAlerts, FEED_URL as DEFAULT_FEED_URL, alertUrl } from "./scrape";
import type { Alert } from "./scrape";
import { classify, CATEGORIES } from "./filter";
import { login, buildPost, createPost } from "./bsky";

export interface HandledStore {
  getLastHandledAt(): Promise<number | null>;
  setLastHandledAt(value: number): Promise<void>;
}

export interface RunConfig {
  feedUrl?: string;
  maxPosts: number;
  bootstrapSilent: boolean;
  bskyHandle: string;
  bskyPassword: string;
}

export async function runOnce(
  store: HandledStore,
  config: RunConfig,
  log: (msg: string) => void,
): Promise<void> {
  const feedUrl = config.feedUrl || DEFAULT_FEED_URL;

  log(`fetching ${feedUrl}`);
  const alerts = await fetchAlerts(feedUrl);
  log(`parsed ${alerts.length} alerts`);

  if (alerts.length === 0) return;

  const lastHandledAt = await store.getLastHandledAt();

  // First run: set watermark to newest alert without posting.
  if (lastHandledAt === null && config.bootstrapSilent) {
    const maxDate = Math.max(...alerts.map(a => a.sendDate));
    await store.setLastHandledAt(maxDate);
    log(`bootstrap: lastHandledAt = ${maxDate}`);
    return;
  }

  const watermark = lastHandledAt ?? 0;

  // Filter to alerts newer than watermark, sorted oldest-first.
  const newAlerts = alerts
    .filter(a => a.sendDate > watermark)
    .sort((a, b) => a.sendDate - b.sendDate);

  log(`${newAlerts.length} new alerts since ${watermark}`);
  if (newAlerts.length === 0) return;

  // Classify and partition into handled (dropped) and post queue.
  const handledIds = new Set<string>();
  const toPost: { alert: Alert; category: string }[] = [];

  for (const alert of newAlerts) {
    const decision = classify(alert);
    if (decision.kind === "drop") {
      handledIds.add(alert.id);
      log(`drop ${alert.id}: ${decision.reason}`);
      continue;
    }
    toPost.push({ alert, category: decision.category });
  }

  log(`${toPost.length} alerts to post`);
  if (toPost.length === 0) {
    // All new alerts were dropped — advance watermark past all of them.
    await store.setLastHandledAt(newAlerts[newAlerts.length - 1].sendDate);
    return;
  }

  // Post up to maxPosts (already in sendDate order, oldest first).
  const batch = toPost.slice(0, config.maxPosts);
  const rateLimited = toPost.slice(config.maxPosts);
  if (rateLimited.length > 0) {
    log(`capping at ${config.maxPosts}; ${rateLimited.length} deferred to next run`);
  }

  const session = await login(config.bskyHandle, config.bskyPassword);
  log(`bsky session as ${session.handle}`);

  for (const { alert, category } of batch) {
    const prefix = CATEGORIES[category] || CATEGORIES.other;
    const text = (alert.body || alert.title).replace(/^\[AlertDC\]\s*/, "");
    const built = buildPost(text, alertUrl(alert.id), prefix);
    try {
      await createPost(session, built);
      handledIds.add(alert.id);
      log(`posted ${alert.id} [${category}]`);
    } catch (err) {
      log(`post failed for ${alert.id}: ${(err as Error).message}`);
      break; // Stop batch to avoid duplicate posts on next run.
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Advance watermark: walk through newAlerts in sendDate order,
  // advance past handled alerts, stop at the first unhandled one.
  // If an unhandled alert shares a sendDate with a handled one, back off
  // by 1ms so the unhandled one is still picked up next run.
  let newWatermark = watermark;
  for (const alert of newAlerts) {
    if (handledIds.has(alert.id)) {
      newWatermark = alert.sendDate;
    } else {
      if (alert.sendDate <= newWatermark) newWatermark = alert.sendDate - 1;
      break;
    }
  }

  await store.setLastHandledAt(newWatermark);
}
