// Shared bot logic. node-entry.ts delegates here.
//
// State is a single watermark: the sendDate of the last "handled" alert.
// An alert is handled when it's either dropped (by filter) or successfully
// posted. Rate-limited alerts are NOT handled — they're retried next run.

import { fetchAlerts, FEED_URL as DEFAULT_FEED_URL, alertUrl } from "./scrape";
import type { Alert } from "./scrape";
import { classify, CATEGORIES } from "./filter";
import { createAgent, resumeOrLogin, buildPost } from "./bsky";
import type { AtpSessionData } from "./bsky";

export interface HandledStore {
  getLastHandledAt(): Promise<number | null>;
  setLastHandledAt(value: number): Promise<void>;
  getSession(): Promise<AtpSessionData | null>;
  setSession(session: AtpSessionData): Promise<void>;
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

  if (lastHandledAt === null && config.bootstrapSilent) {
    const maxDate = Math.max(...alerts.map(a => a.sendDate));
    await store.setLastHandledAt(maxDate);
    log(`bootstrap: lastHandledAt = ${maxDate}`);
    return;
  }

  const watermark = lastHandledAt ?? 0;

  const newAlerts = alerts
    .filter(a => a.sendDate > watermark)
    .sort((a, b) => a.sendDate - b.sendDate);

  log(`${newAlerts.length} new alerts since ${watermark}`);
  if (newAlerts.length === 0) return;

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
    await store.setLastHandledAt(newAlerts[newAlerts.length - 1].sendDate);
    return;
  }

  const batch = toPost.slice(0, config.maxPosts);
  const rateLimited = toPost.slice(config.maxPosts);
  if (rateLimited.length > 0) {
    log(`capping at ${config.maxPosts}; ${rateLimited.length} deferred to next run`);
  }

  const agent = createAgent((session) => store.setSession(session));
  const storedSession = await store.getSession();
  await resumeOrLogin(agent, storedSession, config.bskyHandle, config.bskyPassword, log);
  log(`bsky session as ${agent.session?.handle}`);

  for (const { alert, category } of batch) {
    const prefix = CATEGORIES[category] || CATEGORIES.other;
    const text = (alert.body || alert.title).replace(/^\[AlertDC\]\s*/, "");
    const post = buildPost(text, alertUrl(alert.id), prefix);
    try {
      await agent.post({
        text: post.text,
        ...(post.facets ? { facets: post.facets } : {}),
        langs: ["en"],
        createdAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      });
      handledIds.add(alert.id);
      log(`posted ${alert.id} [${category}]`);
    } catch (err) {
      log(`post failed for ${alert.id}: ${(err as Error).message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  let newWatermark = watermark;
  for (const alert of newAlerts) {
    if (!handledIds.has(alert.id)) break;
    newWatermark = alert.sendDate;
  }

  await store.setLastHandledAt(newWatermark);
}
