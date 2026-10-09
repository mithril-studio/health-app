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

The coach sees the last week in detail plus four weekly totals on every message, and can retrieve the whole twelve-month cache on request through weekly or monthly summaries and detailed range tools. MCP uses `Authorization: Bearer <MCP_AUTH_TOKEN>` from `.env`, Streamable HTTP at `/mcp`. Use a client supporting custom bearer headers (e.g. Claude Code). Browser sessions cannot authenticate MCP. The same tool layer supports calendar, activity, fitness, wellness, curves, workout planning/moves/updates and separately confirmed deletion. Workout writes are echoed to the configured Telegram chat.

Coaching uses the server's **OpenRouter API key** and `OPENROUTER_MODEL`. The live VM had already switched providers before the workout release; that behavior is preserved in this checkout. Only the application's validated training tools are exposed, with bounded tool rounds, read-only scheduled coaching and explicit workout/daily/weekly reviews, and idempotent writes. Provider credentials never reach the browser.

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
python3 deploy/smoke.py --chat     # additionally exercise one paid coaching reply (explicit opt-in)
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

Current single-coach integration: **142 backend, 34 ops (+4 subtests), 11 Worker, 22 frontend unit and 58 Chrome browser tests passed**, plus typecheck, Ruff and production build. See `VERIFICATION.md` for exact scope and unrun checks. This branch has not been deployed.

Changes are maintained in Git with local verification; deployment is a separate operation.

## Web workout beta

Open **Workouts** in the sidebar:

- **Stretching:** five- or ten-minute sequences with ten guided holds, an automatic step timer, pause/resume, and a completion save.
- **Meditation:** 3/5/10/15/20-minute presets or any whole minute from 1 to 120, pause/resume, and a completion save.
- **Log a workout:** record completed fitness, home workouts, soccer, running, cycling, swimming, golf, tennis, walking, yoga, stretching, meditation or other sessions. Enter the start time in your device’s timezone; the calendar uses Amsterdam time. App sessions can be removed from their activity dialog.
- Saved sessions appear in the calendar, overview and coach’s calendar tool. They stay separate from the Intervals cache and are not uploaded to Garmin or Intervals. Missing heart rate, distance and load stay missing. Retrying a save uses the same UUID and cannot add the same session twice.

Timers continue across in-app navigation and recover after reload or browser eviction in the same browser or installed web app. One minimal unfinished-session draft is stored locally, restored after authentication, and synchronized across tabs. Running timers catch up using timestamps; paused timers stay paused. Saving, discarding, or signing out clears the draft; temporary network failures preserve it. If browser storage is unavailable, a warning asks you to keep the tab open. Clearing browser data removes recovery. Completed history, sensor data, and credentials are never stored in localStorage.

Sound is on by default, with a remembered mute control. Stretch changes play a short chime; both timer types play a distinct completion chime. After recovery, tap **Enable sound** or **Resume** if prompted. Missed cues are not replayed. The app requests a screen wake lock where supported, but screen-lock sound is best effort and there are no background notifications. A completion must be saved explicitly; ending early does not record a completed session.

### Retained historical data

Direct WHOOP connection, OAuth callback handling, import endpoints and scheduled import are retired. Existing credentials and imported workout history remain in PostgreSQL for preservation; retained credentials do not activate an integration. Wellness continues to come through Intervals, whose source settings remain authoritative.

Intervals and manually logged sessions take priority over matching historical WHOOP workouts. Matching requires compatible sports, start times within ten minutes and at least 80% overlap of the longer duration. Matching is recalculated when reading data, so later uploads avoid double counting without deleting history. Missing timestamps/durations cannot establish a match. WHOOP strain is never Intervals load; its duration is elapsed time, not moving time.

Migrations 006–008 remain historical schema steps. Saved score rows and former personal zones are retained but no longer override Intervals evidence. Zones and thresholds are managed in Intervals; there is no app zone-write tool.

### Shared athlete context

**Athlete → Profile** holds explicitly saved goals, target date, background, availability, other sports, equipment, constraints, preferences and plan context. Defaults are empty. Revision conflicts require reloading and reconciling your draft.

**Athlete → Coaching record** separates observations, recommendations and questions. Saving creates a proposal; acceptance is a separate explicit action. Accepted records can be completed with an outcome or dismissed. Completed outcomes can be updated. The coach reads this shared context across conversations; chat transcripts are not automatically promoted to memory.

One coach and the existing provider serve chat, workout, daily and weekly modes. Task reviews are read-only. Selecting a workout opens a draft; submitting sends the request. Technical validation uses synthetic data and mocked providers; it does not establish the quality of advice for the athlete's real conversations.
