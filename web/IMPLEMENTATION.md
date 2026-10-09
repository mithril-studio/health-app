# Coach Reachy frontend

Production Next.js App Router / TypeScript frontend. All work in this package stays under `web/`; the backend owns authentication, Intervals access, persistence, tools, and synchronization.

## Run

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:3000`. The same-origin `/api/*` rewrite forwards to `http://127.0.0.1:8001`. Use the backend's configured workspace password. There are no frontend credentials or required frontend environment variables. Public deployment uses HTTPS and the backend's Secure, HttpOnly session cookie; configure the backend's local origin/cookie policy for local development.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
npm start
```

`test:e2e` starts the production build on port 3031 and uses locally installed Google Chrome through Playwright. Build first. `.npmrc` disables lifecycle scripts; dependency versions and `package-lock.json` are pinned. Fonts are self-hosted through the Geist package.

## Delivered

- Overview: current-week load/time and plans, fitness beside a measured weekly HR/pace/power zone split, recovery, upcoming sessions, week rhythm, activity details and measured 5 km progress. Overview and insights pair related visualizations on desktop and stack them on small screens. Zone coverage stays explicit; no estimates replace missing sensor data.
- Calendar: week/month across all returned sports, including football/gym; sport filter, independent calendar range loading, paired planned/done labels and duration comparison. Desktop drag-and-drop and keyboard/native date input both require confirmation. Moves use `POST /api/tools/move_workout` with `{id,date}`. Failed requests restore the original local date and tell the user to refresh before retrying. Completed activities cannot be moved. Mobile uses a chronological agenda with the same controls.
- Activity dialog: lazy `/api/activity/{id}` fetch, raw interval breakdown, recorded HR/pace/power zone time, metric gaps, and a fixed-origin Intervals activity link.
- Insights: CTL/ATL/form with missing dates left as gaps; logarithmic distance/duration curves; running/cycling switch; weekly zone coverage and sport load including football/gym; HRV/sleep/resting HR beside load; real 5 km results and recorded threshold pace history. Charts include accessible data tables.
- Chats: an additional history sidebar lists persistent conversations, starts a new chat, and restores the selected thread via its URL. Existing browser messages stay in their original conversation. The history menu collapses on mobile. Conversation context is isolated on the server; switching is disabled while a reply is in flight. Includes suggestion chips that fill the composer, thinking state, errors, history reload, and retries using the same backend-supported `Idempotency-Key`. No automatic retry of writes. Deletions are loaded from `/api/confirmations`, reviewed in a dialog, and confirmed only by `POST /api/confirmations/{token}/confirm`. Chat text can never invoke that endpoint. Missing optional confirmation endpoints are tolerated.
- Chat is the second sidebar entry. Telegram is a compact, vertically centered link in the upper-right header on every page, replacing the private-workspace label. Unlinked chats open a pairing dialog; linked chats open Telegram directly. The pairing link is generated only after selecting Connect and its HTTPS Telegram domain is validated.
- Semantic OKLCH light/dark tokens, one muted emerald accent, hairline surfaces, Geist, Lucide, 240 px sidebar collapsing to a 64 px icon rail, sidebar-owned collapse control, bottom-left theme control, navigation divider lines, a 64 px header, responsive layouts, keyboard focus, skip link, Radix focus-trapped dialogs, reduced motion, and centralized authored copy in `src/lib/i18n.ts`. Theme and sidebar cookies seed the server shell; preferences are also written locally. The shell follows the supplied e-learning screenshot: one bold h1 in the fixed top bar, a full-width section-menu row below it, and no duplicate page-body title. `PageMenu` portals each page’s controls into the shell; overview/insights use keyboard-accessible tabs, calendar exposes week/month and sport controls, and chats expose conversation actions. Chat history docks flush against the primary sidebar and fills the remaining viewport height, rather than floating inside a content card. Compact controls, menu dividers and no promotional sidebar cards are retained.

## Data and privacy

The server renders the theme and session-checking shell only. Browser requests first verify `/api/session`; private APIs and visible private components are gated on that response. This deliberately overrides the design reference's general first-paint SSR-fetch preference: no private health data is fetched by unauthenticated SSR. Every API request uses same-origin cookies and `no-store`. Logout and 401 responses clear in-memory health data. Session checks are repeated on tab return, with stale results invalidated after logout. Completed health records, conversations, passwords, and API credentials are not stored in localStorage, telemetry, or static assets. The workout timer has one bounded exception: a versioned unfinished-session draft in localStorage (session UUID, routine identifier/name/type, start time, duration, elapsed time, and running/paused timestamp), plus a separate sound preference. This permits recovery in the same browser or installed web app, including completed sessions awaiting explicit saving. The draft is restored only after successful session verification and cleared on save, discard, logout, or confirmed authentication loss; temporary network failures preserve it. Browser data removal also removes recovery. No sensor data or completed session history is cached. Open tabs synchronize the draft and serialize mutations with Web Locks where available, rechecking stored state before acting. Unavailable storage falls back to an in-memory timer with a visible warning.

Workout sound uses synthesized Web Audio chimes, unlocked by Start/Resume/Enable sound gestures. Stretch transitions use one note and completion uses three; mute persists separately. Cues are not replayed after suspension or recovery. Wake locks and sound while the screen is locked are best effort; elapsed time is calculated from timestamps regardless of audio availability.

The dashboard loads the previous year and upcoming 62 days from the backend cache. Calendar navigation independently loads only the visible date range. Missing measurements remain `null`/em dash; recorded zero remains zero. Partial weekly totals say that only recorded load is included. Fitness form is derived only when both CTL and ATL are present. Recovery timestamps are displayed, without invented readiness scores. Dates follow Europe/Amsterdam; date-only arithmetic is independent of browser timezone and daylight-saving changes.

Source-restricted Strava imports are explicitly labeled **Restricted activity**, with the Intervals restriction and direct-upload/connection explanation. We do not assign them invented sports, names, distance, paces, or load. Their existence may count as a completed activity. Aggregate curves and fitness can still be available independently.

5 km progress uses either an exact measured 5,000 m point in the 84-day Intervals pace curve, or actual elapsed times of whole runs between 4.95–5.05 km. Each source is labeled separately. Times are never interpolated, scaled from longer runs, or described as verified race PBs. Whole-run histories show their data-window limits. Threshold history uses recorded `icu_threshold_pace` (metres/second), converted to seconds/km.

## Verification

- 18 unit tests cover missing/zero metrics, malformed responses, raw zone formats, football/gym load, elapsed-time-only 5 km runs, exact 5 km curve points, verified Intervals distance/values curves, fitness derivation, DST date handling, conversational roles, structured deletion capabilities, restricted records, and Telegram link validation.
- 25 core native Chrome/Playwright scenarios cover session-before-data access, incorrect/correct login and logout, light/dark persistence, mobile navigation, populated and empty states, activity intervals, confirmed keyboard moves with error rollback, drag-and-drop success, curves/zones, chat persistence and idempotent retry, explicit deletion confirmation, 401 cleanup, source restriction/curve coexistence, dashboard error recovery, 320/390/768/1024/1440 px layouts, and a regression ensuring calendar refreshes keep visible sessions mounted.
- Axe WCAG A/AA scans are integrated into browser scenarios for login, light/dark empty views, populated views, dialogs, calendar, insights, and coach. Keyboard focus and Escape dismissal are checked. No application JavaScript errors in the populated overview/activity flow.
- Strict TypeScript includes unused-local/parameter checks. Production build succeeds for all four routes. Native `npm audit` reports zero vulnerabilities.
- Visual review used screenshots in ignored `artifacts/`. All synthetic training values exist only in isolated browser/unit test fixtures. The application contains no demo fallback.

## Login regression checks

The password field is read from native FormData at submission rather than React state, so password-manager autofill without change events works with both the button and Enter. A successful password response must be followed by a verified session; otherwise the form keeps the password and shows an actionable cookie/session error rather than silently resetting.

Run `npx playwright test tests/browser/login-recovery.spec.ts` for Chrome and `npx playwright test --config=playwright.webkit.config.ts` for WebKit (install with `npx playwright install webkit` once). These cover autofill and a successful password response without a retained session. The API reports only whether a session cookie reached it; login errors distinguish COOKIE_MISSING from COOKIE_REJECTED. Backend logs record only valid/missing/unknown status, never cookie values or credentials.

## Integration limits

Browser scenarios intercept APIs at the boundary. They verify the frontend contract without using production credentials or changing live workouts. End-to-end delivery to Intervals/Garmin, production cookie configuration, coach provider availability, and Telegram delivery remain backend/deployment integration responsibilities.

The initial contract does not guarantee unrestricted activity details, wellness sensors, threshold history, or a curve for every sport. Their absence is represented explicitly. Only English is currently supplied by the dictionary. Assistant replies render Markdown (headings, emphasis, lists, tables and code) using react-markdown/remark-gfm. Raw HTML and images are disabled, unsafe URL protocols are filtered, and external links use noreferrer. User messages stay plain text; HTML is never executed. Available history length is controlled by the backend.

Automated accessibility checks complement the keyboard/visual review; a full assistive-technology audit has not been performed.
