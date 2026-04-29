# alertdc-bsky

A Bluesky bot that mirrors **AlertDC** (DC's emergency notifications), excluding crime alerts.

## How it works

The bot tracks a **lastHandledAt** watermark — the timestamp of the most recent alert that was "handled" (either dropped by the filter or successfully posted). On each run, it processes alerts newer than the watermark:

- **Dropped** by filter (e.g. crime alerts) → handled, watermark advances
- **Posted** to Bluesky → handled, watermark advances
- **Rate-limited** (exceeds max posts per run) → NOT handled, retried next run

The watermark only advances through contiguous handled alerts. If a rate-limited alert sits between handled ones, the watermark stops before it and those later alerts are retried on the next run.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BSKY_HANDLE` | yes | — | Bot's full Bluesky handle (e.g. `alertdc-bot.bsky.social`) |
| `BSKY_APP_PASSWORD` | yes | — | App password from Bluesky (Settings → App Passwords) |
| `FEED_URL` | no | AlertDC Everbridge endpoint | JSON feed URL to poll |
| `MAX_POSTS_PER_RUN` | no | `3` | Max alerts to post per run |
| `BOOTSTRAP_SILENT` | no | `true` | If `true`, first run sets watermark to newest alert without posting |
| `POLL_INTERVAL_SECONDS` | Docker only | `300` | Polling interval in seconds |
| `STATE_FILE` | Docker only | `./data/state.json` | Path to persistent state file |
| `TRIGGER_SECRET` | CF Workers optional | — | Secret for manual `/run` endpoint trigger |

## Deploy

**Cloudflare Workers**

```bash
npm install
npx wrangler login
npx wrangler kv namespace create STATE
npx wrangler secret put BSKY_HANDLE
npx wrangler secret put BSKY_APP_PASSWORD
npx wrangler secret put TRIGGER_SECRET   # optional
npx wrangler deploy
```

Cron runs every 5 minutes. Manual trigger (if `TRIGGER_SECRET` set):
`https://alertdc-bsky.<your-subdomain>.workers.dev/run?key=<TRIGGER_SECRET>`

**Docker Compose**

```bash
cd docker
cp .env.example .env
# edit .env with your values
docker compose up -d --build
```

State persisted to `./data/state.json`.

## Development

```bash
npm install
npm test
npx wrangler dev
```

## Notes

- First run sets the watermark to the newest alert without posting (`BOOTSTRAP_SILENT=true`). Set to `false` to post the backlog.
- `MAX_POSTS_PER_RUN` caps posts per run (default: 3). Excess postable alerts are deferred — they'll be posted on subsequent runs.
- The bot hits Everbridge's public JSON API directly — subject to change.
- Crime alerts (titles starting with `Crime Alert`) are dropped; police activity road closures and final updates are kept.
