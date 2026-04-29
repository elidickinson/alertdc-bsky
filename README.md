# alertdc-bsky

A Bluesky bot that mirrors **AlertDC** (DC's emergency notifications), excluding crime alerts.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BSKY_HANDLE` | yes | — | Bot's full Bluesky handle (e.g. `alertdc-bot.bsky.social`) |
| `BSKY_APP_PASSWORD` | yes | — | App password from Bluesky (Settings → App Passwords) |
| `FEED_URL` | no | AlertDC Everbridge endpoint | JSON feed URL to poll |
| `MAX_POSTS_PER_RUN` | no | `10` (CF Workers), `3` (Docker) | Max alerts to post per run |
| `BOOTSTRAP_SILENT` | no | `true` | If `true`, first run deduplicates existing alerts without posting |
| `POLL_INTERVAL_SECONDS` | Docker only | `300` | Polling interval in seconds |
| `STATE_FILE` | Docker only | `./data/state.json` | Path to persistent state file |
| `TRIGGER_SECRET` | CF Workers optional | — | Secret for manual `/run` endpoint trigger |

## Deploy

**Cloudflare Workers**

```bash
npm install
npx wrangler login
npx wrangler kv namespace create SEEN
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

- First run deduplicates existing alerts by default (`BOOTSTRAP_SILENT=true`). Set to `false` to post the backlog.
- `MAX_POSTS_PER_RUN` caps posts per run (default: 10 on Cloudflare Workers, 3 on Docker).
- The bot hits Everbridge's public JSON API directly — subject to change.
- Crime alerts (titles starting with `Crime Alert`) are dropped; police activity road closures and final updates are kept.
