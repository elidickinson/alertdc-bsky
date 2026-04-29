# alertdc-bsky

A Bluesky bot that mirrors **AlertDC**, the District of Columbia's official
emergency notification system, **excluding crime alerts**.

It reads alerts from Everbridge's JSON API, classifies each by title,
deduplicates against persistent state, and posts the survivors to Bluesky.

## About the data source

**API endpoint:**
`https://member.everbridge.net/rest/notif/page?orgId=1332612387832012&pageNo=1&pageSize=25`

AlertDC is powered by Everbridge. The public notification page at
<https://member.everbridge.net/1332612387832012/notif> is backed by an
undocumented JSON REST endpoint. This bot hits that endpoint directly.
The risk: Everbridge could lock down or change the endpoint without notice.
If they do, the bot will throw on fetch and log the error — no stale or
wrong data gets posted.

The old HSEMA RSS feed (`trainingtrack.hsema.dc.gov`) is dead — it now
returns HTML instead of RSS XML.

## Deployment paths

Two paths share the same core logic (`src/run.ts`):

- **Cloudflare Workers** — Cron Triggers + KV for state.
- **Docker Compose** — long-lived Node process polling on an interval, with
  state in a JSON file on a mounted volume.

## How filtering works

The classifier is in `src/filter.ts`. It drops:

- **Crime alerts** — title starts with `Crime Alert <Nth> District (PSA …)`.

It deliberately **keeps**:

- Active police-activity road closures (`[AlertDC] Road Closure / Police
  Activity (…)`) — useful traffic information for anyone trying to get
  around DC, not crime news.
- `[AlertDC] Final Update: …` for all categories (including police
  activity) — a Final Update that says a tunnel reopened or a parade
  ended is genuinely useful, even if you didn't see the original alert.

Everything else gets posted with a category emoji:

| Emoji | Category | Title triggers |
|-------|----------|----------------|
| ⛈️ | weather | Tornado / Severe Weather / Snow Emergency / Cold Alert / NWS / Flood / Heat |
| 📅 | event | special event / parking restriction / street closure |
| 🚧 | traffic | DDOT / Tunnel / Lane / Road Closure / Traffic |
| 🚔 | police | Secret Service / Police Activity |
| 🔔 | other | anything that doesn't match a known pattern |

If HSEMA ships a new alert type, you'll see it tagged 🔔 — easy to spot and
add a category for. Edit the rule tables in `src/filter.ts` to taste.

## Bluesky setup (do this first)

1. Create a dedicated bot account on [bsky.app](https://bsky.app/).
2. In the bot account: **Settings → Privacy and Security → App Passwords →
   Add App Password**. Copy the `xxxx-xxxx-xxxx-xxxx` value.
3. Note the bot's full handle (e.g. `alertdc-bot.bsky.social`).

## Bootstrap behavior (important)

On first run, the feed contains the most recent alerts already published.
By default `BOOTSTRAP_SILENT=true`: the first run **records all current
alerts as seen without posting them**, so the bot only posts NEW alerts going
forward. Set `BOOTSTRAP_SILENT=false` if you want to post the entire current
backlog on the first run.

## Deploy: Cloudflare Workers

```bash
npm install
npx wrangler login

# Create the KV namespace, then paste the returned id into wrangler.toml
# under [[kv_namespaces]].id (replacing REPLACE_WITH_KV_ID):
npx wrangler kv namespace create SEEN

npx wrangler secret put BSKY_HANDLE         # e.g. alertdc-bot.bsky.social
npx wrangler secret put BSKY_APP_PASSWORD   # the xxxx-xxxx-xxxx-xxxx value
npx wrangler secret put TRIGGER_SECRET      # optional; pick any string

npx wrangler deploy
```

Cron is set to `*/5 * * * *` in `wrangler.toml`.

If `TRIGGER_SECRET` is set, you can manually trigger a run:
`https://alertdc-bsky.<your-subdomain>.workers.dev/run?key=<TRIGGER_SECRET>`

## Deploy: Docker Compose

```bash
cd docker
cat > .env <<EOF
BSKY_HANDLE=alertdc-bot.bsky.social
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
# Optional:
# POLL_INTERVAL_SECONDS=300
# MAX_POSTS_PER_RUN=10
# BOOTSTRAP_SILENT=true
EOF

docker compose up -d --build
docker compose logs -f
```

State is persisted to `./data/state.json` on the host.

## Local development

```bash
npm install
npm test               # unit tests (filter, parser, post builder)
npx wrangler dev       # run the Worker locally against the live feed
```

The test suite includes a parser test that spins up an in-process HTTP
server with synthetic JSON, so you don't need network access to validate
parsing changes.

## What might break and what to do

**Everbridge changes or locks down the API.** If the endpoint stops
serving JSON or changes the response shape, `fetchAlerts` will throw. The
bot logs the error and retries on the next cron tick. That's the signal
to inspect the raw response and adjust `src/scrape.ts`.

**HSEMA introduces a new title format for crime alerts.** The current
filter relies on titles starting with `Crime Alert`. If MPD changes that
template, crime alerts could leak through — they'll show up under 🔔 other.
Add a new pattern to `DROPS` in `src/filter.ts`.

**A flood of new alerts.** `MAX_POSTS_PER_RUN` (default 10) caps each run.
Anything over the cap is marked seen-but-skipped to avoid spamming the
timeline with stale posts.

**You want to repost a dropped alert.** Delete the entry from KV
(`npx wrangler kv key delete --binding=SEEN alert:<id>`) or from
`data/state.json`, then trigger a manual run.

## License

Do whatever you want.
