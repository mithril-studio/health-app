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
- **Build/checks:** 52 backend + 33 relay + 10 Worker + 14 frontend unit tests; 13 native Chrome scenarios. Typecheck and production builds pass. Frontend/Worker npm audits report zero vulnerabilities; `pip-audit` found no known vulnerabilities in all pinned Python dependencies. Worker dry-run bundling passes.

## External setup still required

1. **Link your personal Telegram chat:** the supplied `TELEGRAM_CHAT_ID` is the bot's ID. The real send attempt returned `403: the bot can't send messages to the bot`. Open **Coach → Connect Telegram**, then follow the one-time link and press Start. Pairing is session-only, hashed, expiring and single-use; arbitrary first senders cannot take ownership. Backend/relay pairing and target overrides are tested. Notifications wait for a valid target; successful real delivery and a genuine user-to-bot reply remain unverified until pairing.
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

Backend tests need an isolated PostgreSQL connection (see backend/IMPLEMENTATION.md). The temporary local test Postgres was stopped after verification; production Postgres remains running on the VM. Browser checks consume one login each; the production login limit is five attempts per fifteen minutes. Screenshot artifacts contain private data and are excluded from git.
