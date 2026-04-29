// Node entrypoint for the self-hosted (Docker) deployment.
//
// Delegates to run.ts for all bot logic; this file only provides the
// file-backed HandledStore adapter and the polling loop.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runOnce, type HandledStore } from "./run";

const STATE_FILE = process.env.STATE_FILE || "./data/state.json";

function parseMaxPosts(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface State {
  lastHandledAt: number | null;
}

async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Gracefully handle old format ({ bootstrapped, seen }) or missing field.
    const value = parsed.lastHandledAt;
    return { lastHandledAt: (typeof value === "number") ? value : null };
  } catch (err: any) {
    if (err.code === "ENOENT") return { lastHandledAt: null };
    throw err;
  }
}

async function saveState(state: State): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, STATE_FILE);
}

// File-backed HandledStore. Loads state once per run, writes once at the end.
function fileStore(): HandledStore & { flush: () => Promise<void> } {
  let state: Promise<State> | null = null;
  const ensure = () => state || (state = loadState());
  let dirty = false;

  return {
    async getLastHandledAt() {
      const s = await ensure();
      return s.lastHandledAt;
    },

    async setLastHandledAt(value: number) {
      const s = await ensure();
      s.lastHandledAt = value;
      dirty = true;
    },

    async flush() {
      if (dirty && state) await saveState(await state);
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
        maxPosts: parseMaxPosts(process.env.MAX_POSTS_PER_RUN, 3),
        bootstrapSilent: (process.env.BOOTSTRAP_SILENT ?? "true") !== "false",
        bskyHandle: handle,
        bskyPassword: password,
      }, (m) => console.log(m));
    } catch (err) {
      console.error(`run failed: ${(err as Error).message}`);
    } finally {
      try {
        await store.flush();
      } catch (err) {
        console.error(`flush failed: ${(err as Error).message}`);
      }
      running = false;
    }
  };

  await tick();
  setInterval(tick, intervalSec * 1000);
}

main().catch((err) => { console.error(err); process.exit(1); });
