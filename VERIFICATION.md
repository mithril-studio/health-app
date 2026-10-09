# Single-coach integration verification — 2026-10-09

Validated on `feat/coach-release`; not merged into main and not deployed. Final inputs: foundation `c777f24`, evidence `52f1d3f`, frontend `bed6db4`. Integration tests use real merged Store methods, isolated schemas in disposable UTF8 PostgreSQL, synthetic training data and mocked network/provider boundaries. The temporary engine Store bridge was removed. No test files were ignored and no paid/live LLM requests were made.

## Passing checks

| Check | Result |
|---|---|
| Full backend `python -m pytest -q --tb=short` | 142 passed |
| Frontend unit tests | 22 passed |
| Strict TypeScript | Passed |
| Production `next build --webpack` | Passed |
| Full Chrome Playwright suite | 58 passed, including accessibility/layout checks |
| Ops `python -m pytest -q ops/tests` | 34 passed plus 4 subtests |
| Worker `npm test` | 11 passed |
| Backend Ruff check; git diff whitespace check | Passed |

Chrome ran against the integration worktree's production build on port 3031 after the frontend agent released it. Installed dependencies were reused through a temporary untracked symlink, removed before delivery. The final engine merge changed backend code/tests and docs only; backend tests and Ruff were rerun after resolution. Baseline before integration was 124 backend passes.

## Independent integration review

- Profile reads/writes use the actual persisted singleton across conversations, with empty defaults, strict input bounds, browser-session/Origin guards and atomic revision conflicts.
- Record creates are idempotent proposals; acceptance, dismissal and completion are explicit revision-checked actions. Concurrent transitions cannot both succeed. Outcomes survive reload. No transcript or assistant response is automatically accepted as memory.
- Outstanding accepted records are selected first within a 50-record bound. Actual database totals and included/omitted counts reach the API and briefs; browser UI discloses omissions. Additional brief budget omissions remain explicit. Accepted observations/questions are not treated as training decisions.
- Real Store→ToolService→brief tests verify retained paired structured targets, real zero, plan descriptions and athlete feedback. Calendar and summary reconcile Intervals, app and unmatched historical WHOOP data. Historical credentials/workouts/score rows survive migrations; no active WHOOP integration remains.
- Explicit task modes enforce read-only tool access. Workout navigation prepares an editable request without automatically submitting. Retry identity includes task and activity; cross-conversation races under one key return 409. Request metadata is excluded from user history.
- Removed zone writes reject through REST/model/MCP. Previously queued WHOOP sync and zone writes terminate without upstream calls, including when Telegram is absent. The stronger integration retirement path was retained when resolving the engine merge.
- Current/activity LTHR is labeled as a proxy. Saved scores have no effect. Hardcoded sub-18/sub-17 targets were removed from active cards/analytics; measured 5 km history remains.
- Relay and Worker implement a Sunday 20:00 Amsterdam weekly trigger, tested alongside existing schedules. Scheduled briefs share the on-demand task path. Existing timer, session logging, login, conversation, calendar and deletion-confirmation behavior remains covered.

CodeRabbit CLI reported **not logged in**. Independent manual adversarial review and tests were used instead; no CodeRabbit review result is claimed.

## Limits and unrun checks

This is technical validation, not a real coach-quality evaluation. Provider responses are mocked: evidence selection, identity, permissions, state transitions and rendering are tested, but useful real advice and resistance to every possible prompt injection are not established. The user has not supplied actual bad conversations or preferences for qualitative before/after review.

No production login/data checks, real Intervals/Garmin mutations, live Telegram sends, paid coaching, production migration, deployment, or real scheduled delivery were performed. Existing live infrastructure status is not reverified here. Weekly scheduling is implemented, not claimed active in production.

WebKit, physical iPhone speaker/lock-screen behavior, live-provider quality, audits requiring network package advisories, and a full assistive-technology audit were not rerun for this integration. Chrome tests intercept APIs; backend tests exercise real PostgreSQL with mocked external services. Full browser-to-live-backend/provider delivery remains an external validation step.

Record context is intentionally bounded: more than 50 outstanding accepted records still requires prioritization and will disclose omissions. Source restrictions and missing sensor detail cannot be repaired by coaching. Historical score/WHOOP tables and credentials remain for preservation; migrations 006–008 are retained, and migration 009 adds shared context without deleting historical data. No migration 010 was needed: task identity uses isolated metadata rows in the existing message store.
