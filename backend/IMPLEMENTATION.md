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

- The cache holds twelve months of activities, wellness and fitness plus planned events twelve months ahead. Every chat attaches a deterministic task brief with recent activities/wellness, read-only Intervals sport settings, confirmed athlete profile, coaching records, freshness and four-week totals.
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
- `Idempotency-Key` is supported for `POST /api/chat` and `POST /api/tools/{name}`; clients should reuse the same key only for identical requests. Chat compares persisted task identity (mode, activity ID and read-only scope) as well as message/channel; mismatches return 409. Task metadata uses a private non-conversation channel in the existing message table, requiring no migration.
- Worker POST routes return **202** after durable enqueue. `key` and Telegram `update_id` are persisted before acknowledgment. A process crash or VM restart resumes unfinished rows. All non-2xx worker responses should be retried upstream with the original stable key.

Raw Intervals records are retained, except credential-named fields are removed defensively. `settings` maps sport name to the raw matching sport-settings object. Fitness is strictly wellness CTL/ATL with `form = ctl - atl`; unknown measurements remain null. Threshold pace units are **metres/second**. Curves return the upstream raw `{list,activities}` structure. Run pace-curve `values` are **seconds at each `distance`**, not pace or speed; an exact 5000 m curve point is a measured best effort. No whole-run 5 km estimate is fabricated.

### Single-coach task briefs

`POST /api/chat` preserves message/conversation fields and adds `mode` (`chat` default,
`workout`, `daily`, `weekly`) and `activity_id` (required for workout, validated with the
existing activity identifier constraints). Explicit advice modes are read-only. Generic chat
retains historical read tools and explicitly requested workout mutations. Zone-write tools
are retired from REST/model/MCP; current Intervals settings remain readable.

All modes use `briefs.build_brief` and the agreed `Store.athlete_profile()` and
`Store.coaching_records()` interfaces. No profile or coaching record is written by chat.
Confirmed goals/availability replace hardcoded personal assumptions. Proposed, accepted,
dismissed and completed records remain separate. Profile, records and descriptions are
untrusted evidence, never permission instructions. Profile plan_context is user-stated
purpose, not proof of a paired calendar event.

Workout briefs load selected activity analysis and interval pages (up to 20 pages and an
18,000-character interval budget). Coverage includes loaded/total counts and continuation;
partial evidence never claims a full review. Paired plan descriptions, supported structured
aggregate targets (duration/distance/load), athlete feedback, recent activities across sports
and up to five prior same-sport duration comparables from 90 days are included. Targets are
never manufactured from titles or free text. Missing pairing, HR and thresholds are explicit.
The underlying analysis still supports pagination beyond the brief cap through read tools.

Threshold precedence is explicit user-supplied LT2, recorded activity LTHR, then current
Intervals sport LTHR. Both LTHR sources are labelled proxies, not measured LT2. Current
settings do not establish a dated historical threshold; HR-zone boundaries never establish
LT1/LT2. Duration above threshold uses recorded timestamp deltas and left HR samples,
excluding gaps over ten seconds and unrecorded tails. Unknown remains null; measured zero
remains zero. This measures time above an HR threshold, not time at VO2max.

Daily briefs prioritize today's plan plus recent workload, wellness and feedback. Weekly
briefs include the past seven days, recorded plan pairings and the upcoming seven days,
with goals/availability and accepted decisions/outcomes in shared context. Both schedulers
queue weekly reviews Sunday at 20:00 Europe/Amsterdam. Morning/evening use daily mode;
activity jobs use workout mode with the selected ID. All scheduled coaching stays read-only.
Old WHOOP sync jobs complete as retired without upstream calls; retained history still
participates in calendar and summary deduplication. These changes are not deployed.

Conversation history remains isolated (latest 12 messages, 15,000-character budget).
Brief sections have explicit evidence budgets and omission markers, preserving selected
workout evidence without dumping raw telemetry. Longer history remains available through
existing date-range tools. Summaries use the calendar's combined activity source and report
missing observations, provenance and cache freshness. No live paid LLM evaluation was run:
tests use representative synthetic evidence and mocked provider responses; no user-supplied
bad-conversation examples were available for response-quality evaluation.

## Persistence and retries

Initial sync loads 12 calendar months; subsequent activity/wellness syncs overlap the cursor by 7 days. Events refresh the retained past-year and next-year window, removing remote-deleted/moved events. All cache replacements and every sync cursor commit in one transaction after every fetch succeeds. Failed syncs preserve prior data and success cursor, recording only a sanitized error class. Intervals source reads use bounded retries with an explicit User-Agent. Lazy intervals, streams and curves hit the cache first.

Writes use strict allowlisted Pydantic schemas shared across REST, MCP and agent calls. The backend writes Intervals first, then refreshes local data. Source sync and writes share a distributed lock to prevent stale sync snapshots overwriting a fresh write. Durable write intent/audit precedes the remote request. Creates use stable Intervals UIDs with `upsertOnUid`; update/delete retries are idempotent. Once remote success is recorded, refresh failures do not reapply the mutation. Successful writes atomically enqueue an audit echo to Telegram; Telegram must be configured before writes are accepted.

Telegram accepts only new text messages in the exact configured chat; only message text is retained, without sender names or the original update. Deduplication and concurrent processing use Postgres constraints plus advisory locks, which release on connection loss. Failed jobs are retained and retried with capped exponential backoff; there is no retry ceiling that silently discards them. Scheduled advice can never invoke write tools. Notifications use a durable outbox and persist each sent chunk.

## Verification (local)

Tests are written before each feature/race fix, with the initial failures observed. The suite uses **real isolated Postgres schemas** and mocked upstream writes/provider/Telegram calls. No destructive real workout writes or real Telegram sends were performed.

```sh
# Set a disposable/local Postgres connection with schema creation permissions.
TEST_DATABASE_URL=postgresql://localhost:65431/postgres .venv/bin/pytest -q
.venv/bin/ruff check coach tests scripts
.venv/bin/ruff format --check coach tests scripts
# Explicit read-only upstream probe, output limited to schema keys/counts/timings:
.venv/bin/python scripts/probe_intervals.py --env ../.env \
  --database-url postgresql://localhost:65431/postgres
```

Latest full suite: **40 passed**, including independent deployment-agent MCP/OAuth/migration tests. Ruff lint and formatting checks pass; `uv pip check` confirms all 47 installed pinned packages are compatible. A cancelled running job was also verified to resume without losing dedup state. Real read-only full sync into an isolated temporary schema completed in **0.241 s** (backfill) and **0.078 s** (incremental): **50 activities, 256 wellness rows, 256 fitness rows, 20 events, 4 sport settings**. The probe then dropped only its temporary schema. Counts can change as the source changes. Upstream docs were consulted at <https://intervals.icu/api/v1/docs>; the official [MCP SDK](https://github.com/modelcontextprotocol/python-sdk), [Claude CLI](https://code.claude.com/docs/en/cli-reference), and [authentication documentation](https://code.claude.com/docs/en/authentication) informed transport choices.

## Known limits

- All 50 probed activity records are upstream-restricted Strava summaries. Intervals/streams respond unavailable for these records. No names, paces, distances or load are invented; direct Garmin/other permitted uploads are needed for full activity details. Run aggregate pace curves remain available.
- Telegram has no send-message idempotency key. A process death after Telegram accepts a send but before its local receipt commits can duplicate one chunk. Delivery is explicitly at least once; successful chunks are otherwise not resent.
- Intervals has no transaction spanning its service and Postgres. If a process dies after an external write but before recording its success, the stable UID/idempotent operation reconciles by replay. External manual edits made during that uncertainty window can be overwritten by that same approved operation. Definite 4xx rejections remain visible for review.
- Cache freshness depends on the service running. The external wake/scheduler and deployment are owned by the main/worker agents. Backend read endpoints render existing cache immediately and enqueue refresh; a newly created empty cache may render empty until initial sync finishes. Data before the 12-month retained window is not automatically backfilled.
- Live Claude tool execution and real Telegram delivery require deployment integration checks; the backend local suite intentionally avoids paid messages and external sends. Long-term PII retention/export policy and production backup encryption must be configured by the owner; local caches/history/outbox contain sensitive training data and require restricted database access.
