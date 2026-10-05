# Hybrid Athlete — Phase 2 Plan

Oct 5, 2026 · @Joost

## Where phase 1 left us

Phase 1 delivered the Intervals.icu cache, the Claude coach (web chat, Telegram, MCP), the calendar and insights pages, and the VM scheduler. Two facts from the live system shape phase 2:

- **The coach was silent from 2 October 08:30 until today.** The CLI could not refresh its OAuth session during the morning report and wiped its tokens. Web chat and Telegram share that login, so both failed, and nothing told you. Fixed today: the failure is logged, the chat page explains it, Telegram sends one alert per day, and `deploy/claude-login.sh` renews the login. The renewal itself needs your browser sign-in (see README).
- **The cache holds no usable sessions yet.** All 49 cached activities are Strava-restricted summaries with no sport type, no name, no detail, and nothing newer than 29 September. Only the 20 planned runs carry a sport. A "how hybrid am I" chart drawn from today's data would be empty, so the data pipe is the first job of phase 2, not the chart.

## Goal

One personal multisport app, on the web and on your phone, that holds every session you do (running, cycling, swimming, golf, tennis, football, gym, home workouts), helps you stay consistent with meditation and stretching, and shows how hybrid your training really is.

## Decisions

**Sessions have two sources, one calendar.** Watch-recorded sessions keep coming through Intervals.icu; Garmin records golf, tennis, swim, strength, yoga and breathwork natively, so connecting Garmin directly to Intervals unlocks all of them with full detail. Sessions without a watch (home workout, stretch, meditation) are logged in the app, in an app-owned `sessions` table, and mirrored to Intervals as manual activities when its API allows it (to verify in the first spike). The calendar and all totals read both.

**Six training domains define "hybrid".** Every sport maps to one domain: Endurance run (run, trail, treadmill), Cycling (road, gravel, MTB, indoor), Swim, Strength (gym, home workout, calisthenics), Ball and racket (football, golf, tennis, padel), Mind and mobility (yoga, stretch, meditation, breathwork). Mapping lives in one backend table so you can change it without a deploy. Load counts only where Intervals measured it; otherwise time is used and labelled as time.

**The hybrid diagram is a radar plus a balance score.** The radar shows the share of time per domain over a rolling four weeks against a target profile you set. The score is the evenness of that distribution (0 = one sport only, 100 = equal across your chosen domains). Both are built from recorded sessions only; the chart never estimates a missing week.

**Phone: installable web app first, native shell second.** The web app becomes a Progressive Web App (manifest, offline shell, home-screen install, Web Push reminders on iOS 16.4+) within a day of work and needs no Apple account. A native iOS app follows as a thin SwiftUI shell around the same web app, signed with your developer account and installed through Xcode or the existing `ship-ios` flow, so you keep one codebase. The native shell earns its place only if we want HealthKit (Apple Watch workouts and Mindfulness minutes) or native notifications.

**Consistency is a scheduler feature, not a new system.** Meditation and stretch streaks reuse the existing morning and evening Telegram touchpoints and the queued-job machinery. The evening report says "stretch not yet done today" and the coach sees meditation and stretch sessions through the same tool layer as everything else.

## Phases

Each phase ends with something you use daily; stop after any of them.

**2.0 Recover and secure the coach (today, your action).** Renew the Claude login on the VM, preferably with a long-lived `claude setup-token` token in `.env` so refresh rotation can no longer break it. Connect Garmin directly to Intervals.icu so new activities arrive with sport and detail. Done when: a web chat reply works, the queued Telegram message from today is answered, and the next activity shows a sport in the calendar.

**2.1 Every session in one place (about a week).**
- Backend: sport normalisation and the domain mapping table; `sessions` table; `log_session` and `get_sessions` tools (REST and MCP); mirror to Intervals when supported.
- Web: a "Log a session" form (sport, start, duration, effort 1–10, notes, optional equipment such as club or racket); calendar and weekly totals across all sports with domain colours; sport filter gains golf, tennis, swim, home workout.
- Done when: a golf round from the watch and a home workout logged by hand both appear in the same week view with the right domain.

**2.2 Hybrid profile (about a week).**
- Insights gets a "Hybrid" tab: radar of time share per domain (rolling 4 weeks), balance score with trend, per-domain bars for the last 12 weeks, editable target profile.
- Coach tool `get_hybrid_profile`; the weekly Telegram summary includes the score and the domain you neglected.
- Done when: you can answer "how hybrid am I this month" from one screen and the coach quotes the same numbers.

**2.3 Mind and mobility (one to two weeks).**
- Meditation: a timer with box breathing and open presets, gentle start and end cues, logs a Mind session.
- Stretching: three to five routines (post-run, hips and hamstrings, upper body, pre-golf), each a list of timed steps with a progress ring; completing a routine logs a session.
- Consistency: a streak and weekly-target card on the overview; evening Telegram nudge when today's target is open; the morning report suggests the routine that fits the day's workout.
- Done when: a week of daily stretch and meditation shows a streak on the overview and in the Telegram evening report.

**2.4 On your phone (about a week).**
- PWA: manifest, icons, service worker for the app shell, install prompt, Web Push for the evening nudge.
- Native iOS shell: SwiftUI app with a web view on the same origin, session cookie kept in the app, signed with your developer account; optional HealthKit import for Apple Watch workouts and Mindfulness minutes.
- Done when: the app is on your home screen, opens straight into the overview, and the meditation timer runs with the screen locked.

**2.5 Reliability (runs alongside).** Health endpoint and overview badge show coach availability; the morning report fails loudly within an hour instead of retrying for days; nightly Postgres backup of app-owned sessions (they are not a cache); Sentry on the API.

## Open questions

- **Which watch do you wear for golf, tennis and swimming?** Garmin sends everything to Intervals; an Apple Watch would need the native shell and HealthKit in 2.4 to arrive automatically.
- **Do old Strava activities matter?** The restriction cannot be lifted retroactively through the API. Exporting the original files from Garmin or Strava and uploading them to Intervals would restore detail for history.
- **Target profile:** equal across all six domains, or weighted towards running while the sub-18 5 km goal stands?
- **Login durability:** a long-lived token (recommended) or the refreshable login with the new daily alert as the safety net?

## Risks

| Risk | Impact | Fallback |
| --- | --- | --- |
| Intervals has no manual-activity endpoint | App-logged sessions stay app-only | Totals and the hybrid chart read both sources; Intervals fitness excludes app-only sessions and says so |
| Refresh-token rotation breaks the coach again | Silent coach | Daily Telegram alert, chat-page notice, long-lived token |
| Web Push needs an installed PWA on iOS | Reminders missed | Telegram nudges remain the primary channel |
| HealthKit requires native code | Apple Watch sessions need manual logging | Native shell in 2.4 only if an Apple Watch is in use |
