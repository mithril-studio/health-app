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

Threshold precedence is explicit user-supplied LT2, saved personal running LT2, activity `lthr`, then current matching
sport-settings `lthr`. The latter two are labeled LTHR proxies, with their provenance.
Durations use recorded time deltas and the HR at each interval's left timestamp, clipped
to session/interval bounds. Values equal to the threshold are excluded. Missing HR,
gaps longer than ten seconds and the unrecorded tail are excluded; incomplete coverage
is labeled as a measured subtotal. Missing thresholds or streams produce null, not zero.
This measures time above a heart-rate threshold, not time at VO2max. Field names follow
the official [Intervals API schema](https://intervals.icu/api/v1/docs).

Each coach turn starts with up to 12 messages from its own channel/conversation, the
calendar from seven days ago through two days ahead, wellness from seven days ago through
today, sport settings, saved personal scores and sync status. The system prompt contains the 5 km sub-18/sub-17
goals and Mon/Tue/Thu/Sun running schedule plus football/gym. There is no cross-conversation
athlete conversation memory. Manually saved scores and zones are shared across chats.
Older cached records require explicit tool queries. The coach uses a
15,000-character history budget: newest messages are retained in order, and very long
messages preserve their beginning/end with an explicit omission marker. Context includes
the count of included and budget-omitted messages; an oversized history is no longer
discarded wholesale when it exceeds the history budget.

Coach calendar/wellness inputs are projected to relevant fields in the OpenRouter loop and scoped MCP calls.
Oversized context sections are marked as omitted independently, preserving other sections
such as thresholds. The API tool-result budget remains 20,000 characters; compact analysis
pages avoid passing raw telemetry to the model. Review instructions prioritize per-set
execution and threshold time, suppress routine metadata and prohibit unsupported claims
about rep progression or cooldown identity. Production response quality still requires
reviewing an actual coach turn; mocked-provider tests verify evidence delivery and calculations.

`Settings > Zones & scores` lets the athlete save, edit and clear running LT1/LT2 heart rates
(integer bpm, 30–250) and VO2max (ml/kg/min, 5–100). Both thresholds must be ordered when
present. `GET /api/athlete-scores` reads the current values; authenticated
`POST /api/athlete-scores` replaces all three, with null clearing an individual value.
Migration 007 stores these independently of Intervals, so sync cannot overwrite them.
These are current benchmarks, not a dated test history. Running LT2 takes precedence over
LTHR for Run, TrailRun and VirtualRun, but does not change cycling analysis or upstream
zones. Every new coach turn receives all three scores; the coach has no tool to edit them.
Migration 008 adds optional personal running `hr_zones`: exactly five Z1–Z5 objects with
inclusive integer `min_bpm`/`max_bpm` limits (30–250), consecutive without overlaps or gaps.
Submitting null clears zones; omitting the field preserves them for older clients.
Workout analysis calculates time in these personal zones from recorded HR/time streams,
reports samples outside the configured ranges and marks partial coverage. It never
relabels the upstream zone totals or infers LT1/LT2 from a zone boundary. The existing
dashboard zone charts still display upstream zone totals.

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
