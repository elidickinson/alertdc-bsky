# alertdc-bsky

A Bluesky bot that mirrors **[AlertDC](https://hsema.dc.gov/page/alertdc)** (DC's emergency notifications). It filters out all the noisy and unhelpful alerts for minor crimes..

## How it works

The bot fetches the JSON API that powers the [official AlertDC alerts page](https://hsema.dc.gov/node/848452) and keeps track of the timestamp of the most recent alert that was "handled" (either dropped by the filter or successfully posted). On each run, it processes alerts newer than the timestamp:

- **Dropped** by filter (e.g. crime alerts) → handled, skipped on next run
- **Posted** to Bluesky → handled, skipped on next run
- **Rate-limited** (exceeds max posts per run) → NOT handled, retried next run

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


## Deploy

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
```

## Notes

- First run sets the watermark to the newest alert without posting (`BOOTSTRAP_SILENT=true`). Set to `false` to post the backlog.
- `MAX_POSTS_PER_RUN` caps posts per run (default: 3). Excess postable alerts are deferred — they'll be posted on subsequent runs.
- The bot hits Everbridge's public JSON API directly — subject to change.
- Crime alerts (titles starting with `Crime Alert`) are dropped; police activity road closures and final updates are kept.
