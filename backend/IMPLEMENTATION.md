# Coach Reachy backend

Backend-only implementation; no deployment performed by this agent. Contract endpoints run at `127.0.0.1:8001`, with the official MCP Python SDK 2.2.0 serving stateless Streamable HTTP directly at `/mcp` (no redirect). Backend dependencies, including transitive packages and test tools, are pinned in `requirements.txt`.

## Setup

```sh
cd backend
uv venv .venv --python 3.12
uv pip sync --python .venv/bin/python requirements.txt
# Populate backend/.env from .env.example, or supply systemd environment variables.
.venv/bin/uvicorn coach.app:app --host 127.0.0.1 --port 8001 --no-access-log
```

Create the Postgres database/user before starting. The user must be able to create tables/indexes in its application schema. Startup runs numbered SQL migrations under a database advisory lock. Migrations must accompany the Python files when deploying. Never expose Postgres or backend port 8001 publicly. Let nginx terminate/proxy the public same-origin HTTPS service. Secure cookies deliberately do not support plain HTTP browser login. Set `APP_ORIGIN` to the exact public origin; forwarded headers never determine which origin is trusted. Configure proxy trust only for the local nginx address, and disable access logging of URLs containing confirmation capabilities. No generated tokens or passwords are included in this repository.

Use independent `APP_PASSWORD`, `API_AUTH_TOKEN` (optional), `MCP_AUTH_TOKEN`, and `BOX_SHARED_SECRET`. Root `.env` is not implicitly loaded when running from `backend/`; use the service's `EnvironmentFile` or a backend `.env`. `SESSION_SECRET` is unnecessary: sessions are opaque random capabilities whose SHA-256 digests and expiry are in Postgres.

## Agent data reach

- The cache holds twelve months of activities, wellness and fitness plus planned events twelve months ahead. Every chat attaches the last seven days of calendar and wellness, sport settings, the shared athlete profile and coaching records, sync status and four weekly totals (`recent_weeks`).
- `get_training_summary(oldest, newest, group_by=week|month)` aggregates any cached range (up to 730 days): sessions, distance, time and load per sport, wellness averages, end-of-period CTL/ATL/form and `missing_load`. Only recorded values are summed.
- `get_calendar` and `get_wellness` return training-relevant fields (see `analytics.COMPACT_FIELDS`), so a full year of wellness is about 55 KB. One tool result may use `AGENT_RESULT_CHARS` characters (default 80000); larger results tell the model the data exists and to summarise or narrow the range.

## Agent configuration

- Coaching uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (default `moonshotai/kimi-k3`). Legacy Claude CLI and Anthropic transport settings are no longer used.
- The OpenRouter chat-completions loop retains opaque reasoning state between tool rounds, validates tool calls strictly and restricts scheduled advice to read tools.
- `AGENT_TIMEOUT_SECONDS`, `AGENT_MAX_TOKENS`, tool and round limits bound each request. Provider errors are sanitized and distinguish authentication, credits, rate limits, unavailable models and timeouts. No provider credentials are exposed to the model.
- MCP remains available for authenticated external clients and scoped capabilities. The built-in coach calls the same tool service directly.

## API integration details

All contract endpoints are implemented. Data APIs accept the secure user session or `API_AUTH_TOKEN`. MCP accepts only `MCP_AUTH_TOKEN` or an expiring internal agent capability. Worker routes accept only `BOX_SHARED_SECRET`. Cookie-authenticated mutations and login require `Origin: APP_ORIGIN`; browser origins are checked even with bearer auth. Persistent rate limiting protects login (5 failed passwords/15 minutes plus 60 total submissions/minute) and data traffic (180 requests/minute/client/principal). Successful logins reset failures rather than consuming the allowance; concurrent password attempts are serialized under a database row lock. Failure lockouts return Retry-After. Validation/error responses omit submitted values and upstream bodies.

Additional endpoints:

- `GET /api/activity/{id}/streams`: lazy stream cache, including explicit unavailable detail for restricted sources.
- `GET /api/confirmations`: **user session only**, returns `{pending:[{token,event_id,snapshot,expires_at}]}`.
- `POST /api/confirmations/{token}/confirm`: **user session + matching Origin only**. No body or model-supplied approval flag. Opaque token expires after 10 minutes; changed workouts require a fresh confirmation. The model never receives this capability. Concurrent confirmations produce one remote deletion.
- `GET /api/jobs`: protected status of pending/retrying work and agent configuration; no payloads or credentials.
- `GET /api/chat` includes the contract `messages` plus `agent` configuration status. Optional `conversation_id` (also accepted by POST) selects an existing browser thread; IDs cannot select Telegram/scheduled channels. `/api/conversations` lists the 100 most recently updated threads (GET) or creates one (POST). Migration 005 preserves the original `web` channel and adds a conversation catalog and message lookup index. No old messages are rewritten. Titles derive from the first user message, and each thread retains the existing 50-message history window and isolated 12-message agent context. Dashboard `insights.agent` also exposes configuration status.
- `Idempotency-Key` is supported for `POST /api/chat` and `POST /api/tools/{name}`; clients should reuse the same key only for identical requests.
- Worker POST routes return **202** after durable enqueue. `key` and Telegram `update_id` are persisted before acknowledgment. A process crash or VM restart resumes unfinished rows. All non-2xx worker responses should be retried upstream with the original stable key.

Raw Intervals records are retained, except credential-named fields are removed defensively. `settings` maps sport name to the raw matching sport-settings object. Fitness is strictly wellness CTL/ATL with `form = ctl - atl`; unknown measurements remain null. Threshold pace units are **metres/second**. Curves return the upstream raw `{list,activities}` structure. Run pace-curve `values` are **seconds at each `distance`**, not pace or speed; an exact 5000 m curve point is a measured best effort. No whole-run 5 km estimate is fabricated.

### Coach workout reviews and context

`get_activity_analysis(id, lt2_hr?, offset=0, limit=30)` returns compact individual intervals,
including measured average HR, pace in seconds/km, and seconds strictly above the threshold.
It reads the existing lazy interval/stream caches; raw activity and stream HTTP endpoints
retain their original response shapes. Follow `next_offset` until null to load all intervals.
Grouped interval averages are never expanded into fabricated reps. Scheduled post-workout
reviews also receive this analysis rather than the raw activity payload.
Analysis includes explicitly paired cached workouts (even if their dates differ). Long
paired descriptions reduce the interval page size automatically so they cannot evict
the individual sets from the normal tool budget. Agent calls to the legacy raw activity
tool receive a compact summary and a pointer to the analysis tool.

Threshold precedence is explicit user-supplied LT2, activity `lthr`, then current matching sport-settings `lthr`. Both LTHR sources are labeled proxies, not measured LT2. Saved app scores and personal zones are ignored. Durations use recorded time deltas and HR at the left timestamp, clipped to session/interval bounds. Values equal to the threshold, missing HR, gaps longer than ten seconds and unrecorded tails are excluded. Partial coverage is a measured subtotal; absent evidence is null, not zero. Time above a heart-rate threshold is not time at VO2max.

### Shared profile and record lifecycle

Migration 009 adds the singleton athlete profile and coaching records without deleting legacy score rows, WHOOP credentials, OAuth state or workouts. Profile GET returns empty text fields, null target date/updated_at and revision 0 before the first save. POST replaces editable fields using atomic optimistic revision checks (409 on conflict). Eight text fields each permit 2,000 characters; target date is an ISO date. Unknown fields are rejected.

Record lists are bounded to 50, prioritizing outstanding accepted records before other recent records. API and brief coverage disclose stored totals, included/omitted counts and accepted-record coverage; per-section budget markers disclose any further reduction.

Record POST requires UUID `id`, `kind`, `text`, and `rationale`, and always creates status `proposed`, revision 1, empty outcome. Kinds are observation/recommendation/question. Text is capped at 4,000 characters; rationale/outcome at 2,000. Identical-ID retries return the current record; different input returns 409. PATCH requires revision/status/outcome: proposed → accepted/dismissed, accepted → completed/dismissed, completed → completed for outcome changes. Stale revisions or invalid transitions return 409; missing IDs return 404. Concurrent transitions cannot both succeed.

Profile and record writes require a browser session and matching Origin. Reads use normal authenticated API access. Models have no write tools for these records. Shared records are explicit user-authored context, distinct from per-conversation transcript history; accepting an observation does not turn it into a training decision.

Direct WHOOP API/OAuth routes and the importer are removed. Historical credentials and workouts are retained, not active integration state. Migrations 006–008 remain unchanged. Queued WHOOP sync and zone writes settle without upstream calls. Score routes and the app zone-write tool are retired; historical score storage exists only for preservation.

### Prepared tasks and retry identity

`POST /api/chat` adds `mode` (chat default, workout, daily, weekly) and `activity_id` (required for workout). Modes are explicit request fields, never inferred from keywords. Workout/daily/weekly modes enforce read-only tool access independently of model instructions. Generic chat retains existing validated workout tools.

Every task uses the same deterministic brief builder. Workout briefs page through ordered intervals with bounded pages/characters and explicit continuation/coverage, include recorded paired plans and structured aggregate comparisons, prior same-sport sessions and recent cross-sport workload. Daily briefs select today's plan, recent workload and wellness. Weekly briefs compare the last seven days with recorded plans and include the upcoming week. Profile plan context describes user intent, not proof of activity pairing. Missing values remain unknown; real zero remains recorded zero.

Relay and Worker schedule weekly reviews Sunday at 20:00 Europe/Amsterdam. Morning/evening use daily briefs; activity jobs use workout briefs. All scheduled tasks remain read-only. This branch does not deploy the schedules.

Request identity includes message, conversation, mode, activity and read-only status. A changed task under an existing Idempotency-Key returns 409 before returning a cached reply. Profile, records and source text are untrusted evidence and cannot override permission rules. Conversation history stays isolated, bounded to 12 messages and a 15,000-character budget; evidence omissions must be disclosed.

## Persistence and retries

Initial sync loads 12 calendar months; subsequent activity/wellness syncs overlap the cursor by 7 days. Events refresh the retained past-year and next-year window, removing remote-deleted/moved events. All cache replacements and every sync cursor commit in one transaction after every fetch succeeds. Failed syncs preserve prior data and success cursor, recording only a sanitized error class. Intervals source reads use bounded retries with an explicit User-Agent. Lazy intervals, streams and curves hit the cache first.

Writes use strict allowlisted Pydantic schemas shared across REST, MCP and agent calls. The backend writes Intervals first, then refreshes local data. Source sync and writes share a distributed lock to prevent stale sync snapshots overwriting a fresh write. Durable write intent/audit precedes the remote request. Creates use stable Intervals UIDs with `upsertOnUid`; update/delete retries are idempotent. Once remote success is recorded, refresh failures do not reapply the mutation. Successful writes atomically enqueue an audit echo to Telegram; Telegram must be configured before writes are accepted.

Telegram accepts only new text messages in the exact configured chat; only message text is retained, without sender names or the original update. Deduplication and concurrent processing use Postgres constraints plus advisory locks, which release on connection loss. Failed jobs are retained and retried with capped exponential backoff; there is no retry ceiling that silently discards them. Scheduled advice can never invoke write tools. Notifications use a durable outbox and persist each sent chunk.

## Verification (local)

Tests are written before each feature/race fix, with the initial failures observed. The suite uses **real isolated Postgres schemas** and mocked upstream writes/provider/Telegram calls. No destructive real workout writes or real Telegram sends were performed.

```sh
# Set a disposable/local Postgres connection with schema creation permissions.
TEST_DATABASE_URL=postgresql://localhost:65431/postgres .venv/bin/python -m pytest -q
.venv/bin/ruff check coach tests scripts
.venv/bin/ruff format --check coach tests scripts
# Explicit read-only upstream probe, output limited to schema keys/counts/timings:
.venv/bin/python scripts/probe_intervals.py --env ../.env \
  --database-url postgresql://localhost:65431/postgres
```

Current integration test counts and limitations are recorded in `../VERIFICATION.md`. Tests use isolated schemas and synthetic fixtures; actual coach-quality review remains separate.

## Known limits

- All 50 probed activity records are upstream-restricted Strava summaries. Intervals/streams respond unavailable for these records. No names, paces, distances or load are invented; direct Garmin/other permitted uploads are needed for full activity details. Run aggregate pace curves remain available.
- Telegram has no send-message idempotency key. A process death after Telegram accepts a send but before its local receipt commits can duplicate one chunk. Delivery is explicitly at least once; successful chunks are otherwise not resent.
- Intervals has no transaction spanning its service and Postgres. If a process dies after an external write but before recording its success, the stable UID/idempotent operation reconciles by replay. External manual edits made during that uncertainty window can be overwritten by that same approved operation. Definite 4xx rejections remain visible for review.
- Cache freshness depends on the service running. The external wake/scheduler and deployment are owned by the main/worker agents. Backend read endpoints render existing cache immediately and enqueue refresh; a newly created empty cache may render empty until initial sync finishes. Data before the 12-month retained window is not automatically backfilled.
- Live coach response quality and real Telegram delivery require deployment integration checks; the backend local suite intentionally avoids paid messages and external sends. Long-term PII retention/export policy and production backup encryption must be configured by the owner; local caches/history/outbox contain sensitive training data and require restricted database access.
