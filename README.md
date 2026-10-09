# Coach Reachy

A private training dashboard and data-grounded coach on Intervals.icu.

**App:** https://coach-reachy.boxd.sh · **Telegram:** https://t.me/coachreachybot · **MCP:** https://coach-reachy.boxd.sh/mcp

## Architecture

- `web/`: Next.js/React dashboard; overview, calendar, insights, coaching chat.
- `backend/`: FastAPI, PostgreSQL cache, Intervals client, shared coaching tools and authenticated MCP.
- `worker/`: Cloudflare cron + authenticated Telegram webhook relay. Amsterdam-local morning/evening slots, 20-minute activity polling, retry state in KV.
- `ops/`: durable VM scheduler and Telegram long-polling fallback when Cloudflare is unavailable.
- `deploy/`: systemd units, private-loopback PostgreSQL bootstrap, nginx and live smoke tests.

Intervals remains the source of truth for Garmin/imported activities and planned workouts. The cache backfills twelve months; planned-workout writes go upstream and refresh the cache. App-recorded sessions and WHOOP workouts live in separate tables, alongside that cache. No demo workouts or fabricated missing measurements.

## Access and secrets

The dashboard uses a private password/session login. The generated password is `APP_PASSWORD` in the local ignored `.env`; the deployed environment is root-owned `/opt/coach-reachy/.env` with mode 600 and loaded by systemd. Never put secrets in browser environment variables.

**To link Telegram:** use **Telegram in the top-right bar → Connect Telegram**, follow the one-time link and press **Start**. The supplied `TELEGRAM_CHAT_ID` is the bot's own ID; a real send test returned `403: the bot can't send messages to the bot`. The app rejects this invalid target. Pairing requires your dashboard session, expires after ten minutes, is single-use, and binds only your private human chat. The binding persists in Postgres and overrides the stale environment value. No arbitrary first sender can take ownership. Reports/notifications wait until you link your chat; real Telegram delivery has not yet been verified.

MCP uses `Authorization: Bearer <MCP_AUTH_TOKEN>` from `.env`, Streamable HTTP at `/mcp`. Use a client supporting custom bearer headers (e.g. Claude Code). Browser sessions cannot authenticate MCP. The same tool layer supports calendar, activity, fitness, wellness, curves, workout planning/moves/updates, zone settings and separately confirmed deletion. Workout writes are echoed to the configured Telegram chat.

Coaching uses the server's **OpenRouter API key** and `OPENROUTER_MODEL`. The live VM had already switched providers before the workout release; that behavior is preserved in this checkout. Only the application's validated training tools are exposed, with bounded tool rounds, read-only scheduled coaching, and idempotent writes. Provider credentials never reach the browser.

If coaching fails, the chat reports a safe provider-specific error for missing/rejected credentials, exhausted credits, rate limits, model errors, or timeouts. Update `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` in the private server environment as appropriate and restart `coach-reachy-api`. Scheduled work stays queued on failures. The older Claude CLI login script is historical and is not used by the current provider.

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

`deploy/bootstrap.py` creates a named Docker volume and loopback-only Postgres container. Environment files are locked to root after bootstrap; run subsequent bootstrap invocations with `sudo`. Intervals tables are a replaceable cache. App-recorded sessions, WHOOP connection credentials and retained WHOOP history are private application data: back up PostgreSQL before replacing or resetting it. OAuth state, pending confirmations and message/job history are private state and should not be committed.

Service logs are private under `/opt/coach-reachy/state/` and rotate after seven daily archives. Journald was unavailable on this VM, so systemd writes to those files directly.

Verification: **58 backend tests, 33 relay tests, 10 Worker tests, 18 frontend unit tests, 25 core Chrome browser tests, 5 WebKit login regression tests**. Production build and live API/MCP smoke checks passed. Real-browser checks found no accessibility violations on all four surfaces and no page overflow at 320/768/1440px. Screenshots contain private data and remain ignored in `artifacts/`. See `VERIFICATION.md` for live status and remaining external setup.

The git history contains incremental local checkpoints. No remote repository was configured or created.

## Web workout beta

Open **Workouts** in the sidebar:

- **Stretching:** five- or ten-minute sequences with ten guided holds, an automatic step timer, pause/resume, and a completion save.
- **Meditation:** 3/5/10/15/20-minute presets or any whole minute from 1 to 120, pause/resume, and a completion save.
- **Log a workout:** record completed fitness, home workouts, soccer, running, cycling, swimming, golf, tennis, walking, yoga, stretching, meditation or other sessions. Enter the start time in your device’s timezone; the calendar uses Amsterdam time. App sessions can be removed from their activity dialog.
- Saved sessions appear in the calendar, overview and coach’s calendar tool. They stay separate from the Intervals cache and are not uploaded to Garmin or Intervals. Missing heart rate, distance and load stay missing. Retrying a save uses the same UUID and cannot add the same session twice.

Timers continue across in-app navigation and recover after reload or browser eviction in the same browser or installed web app. One minimal unfinished-session draft is stored locally, restored after authentication, and synchronized across tabs. Running timers catch up using timestamps; paused timers stay paused. Saving, discarding, or signing out clears the draft; temporary network failures preserve it. If browser storage is unavailable, a warning asks you to keep the tab open. Clearing browser data removes recovery. Completed history, sensor data, and credentials are never stored in localStorage.

Sound is on by default, with a remembered mute control. Stretch changes play a short chime; both timer types play a distinct completion chime. After recovery, tap **Enable sound** or **Resume** if prompted. Missed cues are not replayed. The app requests a screen wake lock where supported, but screen-lock sound is best effort and there are no background notifications. A completion must be saved explicitly; ending early does not record a completed session.

### WHOOP through Intervals.icu

No new developer app is needed for WHOOP wellness data. Connect WHOOP in [Intervals.icu settings](https://intervals.icu/settings) and choose the metrics you want synced. Coach Reachy already reads Intervals’ wellness endpoint, including sleep duration, HRV and resting heart rate. The selected source is managed in Intervals; this app does not independently choose between Garmin and WHOOP wellness values.

The native WHOOP integration does **not currently import workout activities**, according to the [Intervals.icu maintainer’s explanation](https://forum.intervals.icu/t/no-whoop-activities/115164). Its [integration announcement](https://forum.intervals.icu/t/whoop-integration-added/69075) describes the supported wellness metrics. This distinction was checked on 8 October 2026. Any accessible activity that does reach Intervals is already included by our existing activity sync; there is no Garmin-only filter.

For workouts absent from Intervals, use **Log a workout**, or enable the optional direct WHOOP workout importer below. The direct importer does not request or replace WHOOP wellness data.

### Optional direct WHOOP workout import

1. Create a personal application in the [WHOOP developer dashboard](https://developer-dashboard.whoop.com/). Register the exact redirect URL **`https://coach-reachy.boxd.sh/workouts`** (or your configured `APP_ORIGIN` plus `/workouts`).
2. Add `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` to the private server environment, then restart the API. Keep the secret out of browser variables, chat and git.
3. Open **Workouts → Connect WHOOP** and authorize your own account in the browser. The integration requests only `read:workout` and `offline`, following [WHOOP OAuth documentation](https://developer.whoop.com/docs/developing/oauth/).
4. After sign-in, the first sync imports the last 90 days using the [official v2 workout API](https://developer.whoop.com/api/). Background jobs check every 20 minutes while the service is running. **Sync workouts** refreshes immediately. Connection errors remain visible and can be retried or reconnected.

WHOOP authorization state is single-use, expires after ten minutes and is tied to the signed-in browser session. Tokens stay in private PostgreSQL storage; refreshes are serialized to avoid rotating-token races. Disconnect revokes access and stops imports, retaining previously imported history. Reconnecting replaces the WHOOP import set so different accounts cannot be mixed.

Matching Intervals or manually recorded sessions take priority over WHOOP. A match requires compatible sports, start times within ten minutes, and at least 80% overlap of the longer duration. Matching is recalculated when reading data, so a later Garmin upload also removes double counting. WHOOP records remain available in **Recent WHOOP imports**, including the matching status. Missing timestamps/durations cannot be matched reliably and remain included. WHOOP strain is shown separately and is never converted to Intervals training load; WHOOP duration is elapsed time, not claimed moving time. Failed or incomplete imports leave the previous cache untouched.

Migration `006_workouts.sql` runs automatically on API startup. The workout beta was deployed on 9 October 2026 with live authentication, timer, recovery, and accessibility checks. The optional direct WHOOP importer still needs developer credentials and a real consent/import check; existing WHOOP routing was not changed.
