// Node entrypoint for the self-hosted (Docker) deployment.
//
// Delegates to run.ts for all bot logic; this file only provides the
// file-backed SeenStore adapter and the polling loop.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runOnce, type SeenStore } from "./run";

const STATE_FILE = process.env.STATE_FILE || "./data/state.json";
const SEEN_TTL = 60 * 60 * 24 * 30;

interface State {
  bootstrapped: boolean;
  seen: Record<string, { status: string; ts: number }>;
}

async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as State;
    const cutoff = Math.floor(Date.now() / 1000) - SEEN_TTL;
    const seen: State["seen"] = {};
    for (const [k, v] of Object.entries(parsed.seen || {})) {
      if (v.ts >= cutoff) seen[k] = v;
    }
    return { bootstrapped: parsed.bootstrapped === true, seen };
  } catch (err: any) {
    if (err.code === "ENOENT") return { bootstrapped: false, seen: {} };
    throw err;
  }
}

async function saveState(state: State): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, STATE_FILE);
}

// File-backed SeenStore. Loads state once per run, writes once at the end.
function fileStore(): SeenStore & { flush: () => Promise<void> } {
  let state: Promise<State> | null = null;
  const ensure = () => state || (state = loadState());

  return {
    async get(key: string) {
      const s = await ensure();
      if (key === "__bootstrapped__") return s.bootstrapped ? "true" : null;
      return s.seen[key]?.status ?? null;
    },

    async put(key: string, value: string) {
      const s = await ensure();
      if (key === "__bootstrapped__") s.bootstrapped = true;
      else s.seen[key] = { status: value, ts: Math.floor(Date.now() / 1000) };
    },

    async flush() {
      if (state) await saveState(await state);
    },
  };
}

async function main(): Promise<void> {
  const handle = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!handle || !password) throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD must be set");

  const intervalSec = parseInt(process.env.POLL_INTERVAL_SECONDS || "300", 10);
  console.log(`alertdc-bsky starting; polling every ${intervalSec}s`);

  let running = false;
  const tick = async () => {
    if (running) { console.log("skipping tick: previous run still in progress"); return; }
    running = true;
    const store = fileStore();
    try {
      await runOnce(store, {
        feedUrl: process.env.FEED_URL,
        maxPosts: parseInt(process.env.MAX_POSTS_PER_RUN || "10", 10),
        bootstrapSilent: (process.env.BOOTSTRAP_SILENT ?? "true") !== "false",
        bskyHandle: handle,
        bskyPassword: password,
      }, (m) => console.log(m));
    } catch (err) {
      console.error(`run failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
    await store.flush();
  };

  await tick();
  setInterval(tick, intervalSec * 1000);
}

main().catch((err) => { console.error(err); process.exit(1); });
