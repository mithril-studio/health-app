# Backend foundation handoff

Base: `03340c2`; branch: `feat/coach-foundation`. Changes are isolated to this worktree.

## Contract

- Profile GET returns all agreed fields, blank strings/null and revision 0 when absent. POST replaces editable profile fields with atomic revision checking; stale revisions return 409. Eight text fields each allow 2,000 characters (16,000 total); target date must be an ISO date. Store methods accept the validated model or a dictionary and return JSON-compatible timestamps.
- Records GET returns `{records: [...]}` with the newest 50 by creation time. Store `coaching_records()` returns the list directly. Records are shared across conversations.
- Record POST returns 201, including identical-ID retries. Initial revision is 1 and status is always proposed. Identical retries return the current record, including any subsequent user-confirmed status/outcome; changed create input returns 409.
- PATCH requires revision/status/outcome. Supported transitions: proposed to accepted/dismissed; accepted to completed/dismissed; completed to completed for outcome edits. Revision/state conflicts return 409; missing IDs return 404. Reopening dismissed/completed records is unsupported.
- All new writes require a browser session and the existing matching-Origin guard. Reads use existing authenticated API access. Extra fields are rejected. No model write tool was added.
- Migration 009 is additive. Existing score rows, WHOOP credentials, OAuth state and workout history remain untouched. No migration 010 is included here.

## Integration ownership

Engine agent must remove WHOOP dispatch/scheduling from `jobs.py` (old lines 72–73 and 156–159); pending historical `whoop_sync` work should be retired without calling WHOOP. This branch removes app lifecycle wiring, `whoop.py`, config fields and example environment entries. History reads in sessions/tools remain supported.

Engine owns chat changes and removal of score influence from context/analysis. This branch retains legacy Store score methods for retained data and existing analysis tests. In particular, remaining `test_athlete_scores.py` assertions about legacy score context/analysis must be updated with the engine's corresponding behavior changes. Integrator should resolve app imports/chat route overlap. Frontend and engine functionality have not been claimed complete here.

## Verification

`TEST_DATABASE_URL=postgresql://127.0.0.1:65432/health_review <existing-venv>/bin/python -m pytest -q`: **113 passed**. Tests use isolated schemas and mocked providers; no paid coach requests.

New regressions initially failed on the unmodified backend (4 failures), then passed after implementation. Seven new behavioral test functions cover auth/session/origin restrictions, empty profile defaults, ISO/size/type validation, concurrent revision conflicts, create retry identity, explicit status transitions, forbidden acceptance at creation, persistence, cross-conversation access, 50-record bound, nine removed method/path combinations, retained historical reads and additive migration survival.

Removed legacy coverage: 3 score API test functions = 12 parametrized cases; 6 WHOOP importer-specific test functions = 6 cases (normalization, OAuth, pagination/token refresh, failed import reconciliation, integration routes, disconnect). Total **9 functions / 18 cases removed; 7 new behavioral tests added**. Two WHOOP dedup/history tests remain with synthetic stored-record fixtures, alongside existing local-session coverage.

`ruff check coach tests scripts`: passed. Changed Python files pass format check. Full-tree format check flags pre-existing formatting in `coach/telegram_link.py`, `tests/test_telegram_link.py`, and `tests/test_telegram_target_outage.py`; these files are unchanged.
