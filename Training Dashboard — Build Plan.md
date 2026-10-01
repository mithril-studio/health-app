# Training Dashboard — Build Plan

Oct 1, 2026 · @Joost

## Goal & scope

Build a personal training dashboard and coaching agent on top of the Intervals.icu API: a clean UI for insights, an MCP server for chat, and three daily Telegram touchpoints. Everything runs on one boxd VM that sleeps when idle; a Cloudflare Worker handles scheduling and wake-ups.

- **In scope:** calendar, fitness/power/pace/zone insights, agent with read + write tools, Telegram bot (push + two-way chat), MCP server for Claude.
- **Out of scope (for now):** multi-user, native mobile app, own activity-file parsing (Intervals.icu does that).

## Architecture

&#91;embedded content: architecture · Worker, boxd VM, Intervals.icu, Garmin\]

All three entry points land on the same boxd VM; only the Worker runs around the clock, and it costs nothing while idle. Intervals.icu stays the source of truth and pushes planned workouts on to Garmin.

## Triggers

Only three jobs run, all sent to Telegram. Cloudflare cron runs in UTC, so each time is scheduled at both its summer and winter UTC slot; the Worker checks Amsterdam local time and skips the wrong one.

| Job | When (Amsterdam) | Cron (UTC) | What the agent sends |
| --- | --- | --- | --- |
| Morning check | 08:30 | `30 6,7 * * *` | HRV, sleep, resting HR + today's workout; go as planned or a suggested adjustment |
| After workout | Within \~30 min of upload | `*/20 * * * *` poll | Planned vs. done, pace per interval vs. target, one thing to improve |
| Evening report | 21:00 | `0 19,20 * * *` | Day load, recovery status, tomorrow's session |

The after-workout poll runs in the Worker against the Intervals.icu API and only wakes the box when a new activity appears. If Intervals.icu offers activity webhooks, they replace the poll.

## UI

A Next.js app with one calendar view and one insights view, reading only from the local Postgres cache.

**Calendar**

- Week and month view of planned and completed workouts, all sports.
- Planned vs. done per session: compliance colour, link to the activity.
- Drag to move a planned workout; changes are written back to Intervals.icu and reach Garmin.

**Insights**

- Fitness chart: CTL, ATL and form over time.
- Power curve (cycling) and pace curve (running), with a sport switch.
- Time in zones per week (HR, pace, power).
- Weekly load per sport, football and gym included.
- Recovery panel: HRV, sleep and resting HR beside training load.
- Goal tracker: 5 km time and threshold pace over time, with the sub-17/18 target line.

## Agent & MCP tools

One tool layer, used by two front doors: the Telegram agent (Claude API with tool use, running on the box) and the MCP server (for chatting from Claude). Read tools hit the cache; write tools go to Intervals.icu and then refresh the cache.

| Tool | Type | Does |
| --- | --- | --- |
| `get_calendar` | read | Planned and completed workouts for a date range |
| `get_activity` | read | One activity with intervals, zones and planned-vs-done |
| `get_fitness` | read | CTL, ATL, form over a range |
| `get_wellness` | read | HRV, sleep, resting HR, weight |
| `get_curves` | read | Power or pace curve for a period |
| `plan_workout` | write | Create a workout on a date (Intervals text format) |
| `move_workout` | write | Move a planned workout to another date |
| `update_workout` | write | Change steps or paces of a planned workout |
| `delete_workout` | write | Remove a planned workout (asks for confirmation) |
| `update_zones` | write | Set threshold pace, FTP or HR zones |

The agent's system prompt holds your goals, weekly structure (runs Mon/Tue/Thu/Sun, football, gym) and current paces. Every write is echoed back in Telegram so you see what changed.

## Data & sync

Postgres on the box is a cache of Intervals.icu, never the source of truth. That keeps the UI fast and the API calls few.

**Tables:** `activities`, `activity_intervals`, `events` (planned workouts), `wellness`, `fitness_daily`, `sport_settings`, `agent_messages` (Telegram history), `sync_state` (last sync per resource).

**Sync strategy**

1. **Backfill once:** last 12 months of activities, wellness and fitness.
2. **On wake:** every time the box wakes (any trigger or UI visit), sync everything newer than `sync_state` before doing anything else.
3. **On write:** after a write tool, re-fetch the touched events.
4. **Streams lazily:** fetch full activity streams only when a chart or the agent needs them.

## Security & env vars

Each entry point has its own guard: Cloudflare Access on the UI, a bearer token on the MCP server, a shared secret between Worker and box, and the Telegram bot locked to one chat ID.

| Variable | Worker | Box | Purpose |
| --- | --- | --- | --- |
| `INTERVALS_API_KEY` | yes | yes | Intervals.icu API (rotate the one shared in chat) |
| `INTERVALS_ATHLETE_ID` | yes | yes | Athlete `i734994` |
| `TELEGRAM_BOT_TOKEN` | yes | yes | Bot from @BotFather |
| `TELEGRAM_CHAT_ID` | yes | yes | Only your chat is answered |
| `TELEGRAM_WEBHOOK_SECRET` | yes |  | Verifies requests come from Telegram |
| `BOX_URL` | yes |  | HTTPS URL of the boxd machine |
| `BOX_SHARED_SECRET` | yes | yes | Worker-to-box authentication |
| `BOXD_API_TOKEN` | if needed |  | Only if HTTP requests do not wake the box |
| `ANTHROPIC_API_KEY` |  | yes | Agent |
| `MCP_AUTH_TOKEN` |  | yes | Protects the MCP server |
| `DATABASE_URL` |  | yes | Postgres |
| `TZ` |  | yes | `Europe/Amsterdam` |

Worker secrets go in `wrangler secret`; box secrets in a root-only `.env` loaded by systemd.

## Build phases

Each phase ends with something usable, so you can stop after any of them.

1. **Foundation:** boxd VM, Postgres, FastAPI skeleton, Intervals.icu client, backfill + sync-on-wake.
   - Done when: 12 months of data in Postgres and a sync after wake takes under 30 s.
   - First test: does an HTTP request wake a sleeping box?
2. **Tool layer + MCP server:** the read and write tools, exposed over MCP with token auth.
   - Done when: you can ask Claude about last week's runs and move a workout from chat.
3. **Telegram + Worker:** bot, webhook, crons for 08:30 and 21:00, after-workout poller.
   - Done when: all three messages arrive for a full week, and replies to the bot are answered.
4. **UI:** calendar first, then fitness, curves, zones, recovery and goal tracker.
   - Done when: the calendar replaces opening Intervals.icu for daily use.
5. **Polish:** Cloudflare Access, error alerts (Sentry), agent evals on real weeks (Langfuse).

## Risks & open questions

| Risk | Impact | Fallback |
| --- | --- | --- |
| boxd may not wake on an incoming HTTP request | MCP calls and Telegram replies time out | Worker wakes the box via the boxd API, then forwards the request |
| Python's default HTTP client got a 403 from Intervals.icu (curl worked) | Sync fails silently | Use `httpx` with an explicit User-Agent; alert on non-200 |
| Intervals.icu API rate limits | Backfill or polling throttled | Cache-first reads, backoff, poll every 20 min |
| Agent changes a workout wrongly | Wrong session on the watch | Every write echoed in Telegram; deletes need confirmation |
| Cold start delay after sleep | Slow first UI load | Sync after first render, show cached data immediately |

- [ ] Does Intervals.icu offer activity webhooks for personal API keys?
- [ ] Which MCP client: Claude desktop/web connector or Claude Code?
- [ ] Should the Worker send a short fallback message to Telegram when the box fails to wake?
