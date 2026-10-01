# Coach Reachy

A private training dashboard and data-grounded coach on Intervals.icu.

**App:** https://coach-reachy.boxd.sh · **Telegram:** https://t.me/coachreachybot · **MCP:** https://coach-reachy.boxd.sh/mcp

## Architecture

- `web/`: Next.js/React dashboard; overview, calendar, insights, coaching chat.
- `backend/`: FastAPI, PostgreSQL cache, Intervals client, shared coaching tools and authenticated MCP.
- `worker/`: Cloudflare cron + authenticated Telegram webhook relay. Amsterdam-local morning/evening slots, 20-minute activity polling, retry state in KV.
- `ops/`: durable VM scheduler and Telegram long-polling fallback when Cloudflare is unavailable.
- `deploy/`: systemd units, private-loopback PostgreSQL bootstrap, nginx and live smoke tests.

Intervals remains the source of truth. The cache backfills twelve months; writes go upstream and refresh the cache. No demo workouts or fabricated missing measurements.

## Access and secrets

The dashboard uses a private password/session login. The generated password is `APP_PASSWORD` in the local ignored `.env`; the deployed environment is root-owned `/opt/coach-reachy/.env` with mode 600 and loaded by systemd. Never put secrets in browser environment variables.

**To link Telegram:** use **Telegram in the top-right bar → Connect Telegram**, follow the one-time link and press **Start**. The supplied `TELEGRAM_CHAT_ID` is the bot's own ID; a real send test returned `403: the bot can't send messages to the bot`. The app rejects this invalid target. Pairing requires your dashboard session, expires after ten minutes, is single-use, and binds only your private human chat. The binding persists in Postgres and overrides the stale environment value. No arbitrary first sender can take ownership. Reports/notifications wait until you link your chat; real Telegram delivery has not yet been verified.

MCP uses `Authorization: Bearer <MCP_AUTH_TOKEN>` from `.env`, Streamable HTTP at `/mcp`. Use a client supporting custom bearer headers (e.g. Claude Code). Browser sessions cannot authenticate MCP. The same tool layer supports calendar, activity, fitness, wellness, curves, workout planning/moves/updates, zone settings and separately confirmed deletion. Workout writes are echoed to the configured Telegram chat.

Claude chat uses the **official Claude CLI with your Claude OAuth login**, not a subscription OAuth token mislabeled as an Anthropic API key. General CLI tools and ambient MCP servers are disabled for coaching. Only the application's validated training tools can execute actions. OAuth credentials live separately in `/opt/coach-reachy/claude-auth`, readable only by the service user. The official CLI can refresh its login there. If authentication expires/revokes, reauthenticate as `boxd`; do not print or commit the credential file.

The VM's bot protection must be **off** for authenticated API/MCP/Worker traffic. App authentication stays on. Postgres, Next.js and FastAPI listen on loopback; nginx is the public entry point.

## Important live-data limitations

The connected athlete's 50 historical activities currently return Intervals' restriction: `STRAVA activities are not available via the API`. Planned events, wellness/fitness history and the aggregate running pace curve are accessible. Individual activity details, interval comparisons, per-sport loads and zones cannot be manufactured from restricted records. Connect Garmin directly to Intervals or upload original activity files there to make future detailed data available. The app does not bypass Strava's restriction.

Cloudflare's CLI currently reports **not authenticated**. Consequently the Worker is implemented/tested but **not deployed**; VM scheduling/Telegram polling is the operational fallback. The VM must remain awake in this mode. Cloudflare Access is not provisioned; the dashboard's own authenticated session is the active protection.

## Cloudflare cutover

1. Authenticate the account: `cd worker && npx wrangler login`.
2. From the project root run `python3 deploy/publish-worker.py`. It creates/reuses KV and uploads only required Worker secrets via stdin, not command-line arguments.
3. Verify the returned Worker URL's `/health`; run `npm test` in `worker/`.
4. Stop the VM polling relay before configuring Telegram's webhook. Set the webhook to `https://<deployed-worker>/telegram` with the matching `TELEGRAM_WEBHOOK_SECRET`. Preserve pending updates (`drop_pending_updates=false`). Do not run polling and webhooks simultaneously.
5. Verify a real bot reply and an authenticated Worker-to-box job. The backend's persistent job keys deduplicate overlap across the fallback and Worker.
6. Disable the fallback service. Then configure `boxd machine config set coach-reachy auto-suspend.timeout 300`. Keep auto-hibernate off until cold-start behavior is verified. Incoming HTTP wake-up has been verified with boxd bot protection disabled.

Never enable sleep while relying on in-VM cron/long polling: sleeping clocks cannot execute scheduled jobs.

## Development and verification

Python 3.12+, Node 24+, PostgreSQL 17. Copy `backend/.env.example` as a reference, but keep real configuration in the ignored root `.env`.

```sh
cd backend
uv venv .venv
uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt
cd ../web && npm ci --ignore-scripts
cd ../worker && npm ci --ignore-scripts
cd ..
# Backend integration tests require a disposable Postgres connection with schema creation rights:
# export TEST_DATABASE_URL=postgresql://localhost:65431/postgres
make test
make build-web
python3 deploy/smoke.py            # live read-only auth/data/MCP checks
python3 deploy/smoke.py --chat     # additionally exercise one OAuth coaching reply
```

See `backend/IMPLEMENTATION.md`, `web/IMPLEMENTATION.md` and `ops/README.md` for component-specific details and tests. Automated tests use synthetic fixtures, not committed personal health data. Live smoke tests print statuses/counts, never passwords or workout payloads. No destructive real workout mutation is used in verification.

## Operations

```sh
boxd machine exec coach-reachy -- 'systemctl is-active coach-reachy-api coach-reachy-web nginx'
boxd machine exec coach-reachy -- 'sudo tail -60 /opt/coach-reachy/state/api.log'
# Update the existing VM without copying secrets or OAuth credentials:
bash deploy/update.sh
```

`deploy/bootstrap.py` creates a named Docker volume and loopback-only Postgres container. Environment files are locked to root after bootstrap; run subsequent bootstrap invocations with `sudo`. Database data is a replaceable cache, not a substitute for Intervals. OAuth state, pending confirmations and message/job history are private state and should not be committed.

Service logs are private under `/opt/coach-reachy/state/` and rotate after seven daily archives. Journald was unavailable on this VM, so systemd writes to those files directly.

Verification: **58 backend tests, 33 relay tests, 10 Worker tests, 18 frontend unit tests, 22 Chrome browser tests, 5 WebKit login regression tests**. Production build and live API/MCP smoke checks passed. Real-browser checks found no accessibility violations on all four surfaces and no page overflow at 320/768/1440px. Screenshots contain private data and remain ignored in `artifacts/`. See `VERIFICATION.md` for live status and remaining external setup.

The git history contains incremental local checkpoints. No remote repository was configured or created.
