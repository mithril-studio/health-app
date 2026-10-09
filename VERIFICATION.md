## Live workout release — 9 October 2026

Release commit `9e49c49` was pushed to `origin/main` and deployed to https://coach-reachy.boxd.sh/workouts. API, web, relay, and nginx are active; migration `006_workouts.sql` applied. Live checks passed for anonymous access rejection, authenticated dashboard/MCP reads, logout, workout page accessibility and widths 320/390/1440, stretch transitions, pause/reload/resume, meditation completion, and draft cleanup. No live workout records were created. The coach still reports OpenRouter transport; no paid coaching request was sent. Release checks also passed: 81 backend tests, 22 frontend unit tests, 43 Chrome scenarios, TypeScript, Ruff, and production builds locally and on boxd. The prior workout WebKit run passed 35 scenarios.

The boxd source comparison found a deployed OpenRouter migration absent from this branch and `origin/main`. The workout release preserves that live agent, its error handling, and the chat retry behavior; it does not revert to Claude CLI login. Source and PostgreSQL backups were created on the VM under `state/backups/workouts-20261009/` before deployment. Tests for the obsolete provider were replaced with coverage of the deployed provider, tool limits, read-only restrictions, retry identity, safe errors, and reasoning-state continuity. Full backend suite: 81 passed. Physical iPhone speaker/lock-screen verification remains outstanding.

## Stretching and meditation polish — 8 October 2026

Implemented locally; not deployed. Existing routines, app-calendar destination, session API, and WHOOP routing are unchanged.

- A versioned, validated browser draft preserves running/paused/completed timers and the session UUID through reloads. Restore waits for authentication. Save/discard/logout clear the draft; transient failures preserve it. Storage failure shows a warning and leaves the in-memory timer usable. Storage events plus same-origin Web Locks protect against stale tabs and late save responses.
- Optional synthesized chimes play at stretch changes and completion. Sound defaults on, mute persists, and recovery offers a user-gesture unlock. Background/missed cues are not replayed. Completion text prompts saving until the server confirms success.
- Validation: 22 frontend unit tests; TypeScript and production build; 43 Chrome browser scenarios; 35 WebKit scenarios (23 desktop, 12 iPhone-emulated); four focused backend tests covering session validation, authorization, and concurrent save idempotency. Backend checks use an isolated PostgreSQL schema; browser tests use synthetic API fixtures. WebKit ran in an isolated Ubuntu 24.04 runtime because this Amazon Linux host lacks its dependencies. Cue counts are checked with a controlled AudioContext; a separate check verifies actual browser AudioContext activation.
- Browser coverage includes running/paused/completed reload recovery, lost save responses and identical retries, confirmed authentication loss versus transient failure, malformed/blocked storage, tab synchronization and stale actions, replacement sessions during an in-flight save, mute persistence, foreground/background cue behavior, and audio/wake-lock failure. Workout layout/Axe checks pass at phone and desktop sizes. Screenshots in `.context/` contain synthetic data only.
- Reproduce on a Playwright-supported host: `cd web && npm test && npm run typecheck && npm run build && npx playwright test`; install WebKit with `npx playwright install webkit`, then run `npx playwright test -c playwright.webkit.config.ts` for desktop and iPhone-emulated coverage.

**Physical iPhone smoke test still required:** in Safari and the installed web app, start a stretch session, hear a step chime with device volume on, mute/unmute, pause and reload (remaining time stays fixed), resume and lock/unlock (time catches up), then reload again and enable sound. Complete a one-minute meditation, confirm it is not yet in the calendar, save once, and confirm one entry after reload. Test a failed save with connection loss and retry after reconnection; finally verify sign-out removes an unfinished draft. WebKit emulation does not verify device speaker output, OS eviction, or screen-lock behavior. Recovery is specific to each browser/installation; no physical iPhone is attached to this cloud workspace.

## Web workout beta — 8 October 2026

Implemented locally; not deployed and no live WHOOP grant or workout writes were used.

- Added stretching/meditation timers, completed-session logging, app-session removal, sport categories, and the official WHOOP v2 integration.
- Backend: 72 tests passed in the full suite. Subsequent focused checks passed after the coach source guidance and session-lock changes; the 10 new workout tests cover session/origin guards, validation, retry/concurrent idempotency, sync survival, calendar/tool/detail consistency, WHOOP pagination, rotating-token concurrency, partial failure rollback, deletion reconciliation, OAuth state binding/expiry/replay, disconnect, and late-Garmin deduplication.
- Web: 21 unit tests passed, TypeScript and production build passed. Existing browser scenarios plus six workout scenarios passed across the full run and targeted reruns. The old sidebar-collapse test now waits for the animation to settle and measures both rectangles in one frame.
- New Chrome browser coverage: layouts at 320/390/1440px; Axe scans of the workout page and active timer; automatic stretch transitions after suspension; pause/resume and route navigation; same-ID save retries; home-workout/soccer logging; temporary session-check failure recovery and logout cleanup; WHOOP callback URL cleanup and duplicate visibility.
- Screenshots: `.context/workouts-desktop.png`, `.context/workouts-iphone.png`, `.context/stretch-timer-iphone.png`. These use empty/synthetic API fixtures and are gitignored.
- Remaining external verification: WHOOP developer credentials and browser consent, a real import against Garmin records, production deployment, and physical-iPhone checks. Timer recovery and WebKit coverage were added in the polish pass below; background notifications remain out of scope.

# Live verification — 1 October 2026

## Working and verified

- **HTTPS app:** https://coach-reachy.boxd.sh. Overview, calendar, insights and coach pages render against real cached data.
- **Intervals:** authenticated live reads; twelve-month backfill and incremental synchronization into PostgreSQL. Live dashboard smoke saw 50 activity records, 256 wellness/fitness days and 15 events in its requested display window. Full event cache includes a broader future window. Restricted records are not treated as complete workouts.
- **Claude OAuth:** official CLI login verified on the private VM with an isolated environment. A real web-chat request completed in 33.5 seconds. A second request explicitly used the MCP running-curve tool and reported the exact measured 5 km result, independently checked against the API, in 48.2 seconds. No API-key substitution or fake coach responses.
- **MCP:** authenticated Streamable HTTP initialize and catalog of 10 tools at `/mcp`; anonymous and wrong-scope access rejected. Read-only internal capabilities cannot call write tools.
- **Privacy guards:** login/session/logout, cookie attributes, Origin checks and public API/MCP rejection tested. No credentials found in git history.
- **Browser:** live Chrome checks across all four surfaces: no JavaScript errors or Axe A/AA violations. No horizontal body overflow at 320, 768 or 1440 px. Source warnings, running curve, fitness and real planned workouts display correctly. Native browser tests cover move confirmation/rollback, drag-and-drop, chat retry and separate deletion confirmation using synthetic fixtures.
- **Services:** PostgreSQL (private loopback), FastAPI, Next.js, nginx and the fallback relay are running. VM HTTP wake works when bot protection is disabled. Suspend/hibernate are intentionally off while relying on VM scheduling.
- **Scheduling implementation:** morning 08:30, evening 21:00 Amsterdam and 20-minute activity polling. Fallback relay has persisted its activity baseline; tests cover both DST changes, retry/backoff, deduplication, crash recovery and non-flooding startup. A seven-day live delivery run has not been performed.
- **Build/checks:** 58 backend + 33 relay + 10 Worker + 18 frontend unit tests; 25 core native Chrome scenarios and 5 WebKit login regression scenarios. Typecheck and production builds pass. Frontend/Worker npm audits report zero vulnerabilities; `pip-audit` found no known vulnerabilities in all pinned Python dependencies. Worker dry-run bundling passes.

## Update — 5 October 2026

- **Coach outage found and explained:** the VM's Claude OAuth session could not be refreshed during the 2 October 08:30 report and the CLI wiped its tokens (`claude auth status` reports `loggedIn: false`). Every web chat, Telegram reply and scheduled report since then failed with `AgentUnavailable` and kept retrying silently; today's Telegram message and the 2 and 5 October morning reports are still queued and will be answered once the login is renewed.
- **Hardening shipped:** the API logs one sanitized `claude_cli_failed` line per attempt, reports `Claude login on the server expired…` as the agent reason, recovers automatically when a new credential file appears, sends one Telegram alert per day while Claude is unreachable, and the chat page shows that reason and disables the composer. `deploy/claude-login.sh` renews the isolated login. Backend suite now 62 tests, frontend 19 unit tests.
- **Not yet verified:** a real reply after renewal needs the owner's browser sign-in; run `python3 deploy/smoke.py --chat` afterwards.

## External setup still required

1. **Link your personal Telegram chat:** the supplied `TELEGRAM_CHAT_ID` is the bot's ID. The real send attempt returned `403: the bot can't send messages to the bot`. Open **Telegram in the top-right bar → Connect Telegram**, then follow the one-time link and press Start. Pairing is session-only, hashed, expiring and single-use; arbitrary first senders cannot take ownership. Backend/relay pairing and target overrides are tested. Notifications wait for a valid target; successful real delivery and a genuine user-to-bot reply remain unverified until pairing.
2. **Cloudflare account login:** Wrangler reports unauthenticated. The Worker is implemented, tested and ready to publish, but is not live. Cloudflare Access is also not configured. The password-protected app and VM scheduling fallback are active instead. See README's cutover procedure; do not suspend the VM before it is completed.
3. **Detailed activity source:** every current activity is Strava-only and carries Intervals' API restriction. Direct Garmin synchronization or original-file uploads to Intervals are needed for individual intervals, zones and planned-versus-done detail. Aggregated running pace curves, planned events and fitness remain available. Cycling curves and recovery sensors are shown only when actually supplied.

## Deliberately not claimed

No real workout was created, moved, updated or deleted during testing. Upstream write behavior, audit echoes and confirmation gates have automated coverage, but a full production Intervals-to-Garmin write round trip is not verified. Sentry, Langfuse, Cloudflare Access and production backup/retention automation are not provisioned. The app is a personal single-user deployment, not a compliance-audited multi-user health platform.

## Reproduce

```sh
make test
cd web && npm run build && npm run test:e2e && npm audit
cd ../worker && npm test && npx wrangler deploy --dry-run
cd ..
python3 deploy/smoke.py
python3 deploy/smoke.py --chat
node deploy/browser-smoke.mjs
```

Backend tests need an isolated PostgreSQL connection (see backend/IMPLEMENTATION.md). The temporary local test Postgres was stopped after verification; production Postgres remains running on the VM. Successful logins no longer consume the failure allowance. Production limits failed passwords to five per fifteen minutes, with atomic concurrent checks and a Retry-After header; a separate coarse limit caps all login submissions at sixty per minute. Screenshot artifacts contain private data and are excluded from git.
