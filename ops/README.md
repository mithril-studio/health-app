# Coach Reachy VM fallback

An asyncio process for the period when Cloudflare is unavailable. Python 3.9+
(with the OS `tzdata` package) and `httpx`; no backend package imports.
`coach-reachy-relay.service` runs as `boxd`. No timer is needed: independent loops
check schedules every 30 seconds and long-poll Telegram for 30 seconds. Slow
Telegram delivery does not block the scheduler.

This directory only provides implementation and deployment instructions. The
main agent/operator owns installation, environment setup, and starting services.

## Runtime contract

The backend at **`http://127.0.0.1:8001`** receives:

- `POST /api/internal/job`: `{kind, key, activity_id?}`.
- `POST /api/internal/telegram`: the original authorized Telegram update.
- `GET /api/internal/telegram-target`: `{chat_id: string | null}`.
- All use `Authorization: Bearer <BOX_SHARED_SECRET>`.

**The backend generates the agent response and sends Telegram messages.** This
process never calls `sendMessage`. Backend processing must deduplicate job keys
and Telegram `update_id` durably, including retries after a timeout or crash.
A JSON object in a successful 2xx response acknowledges the handoff, unless
`ok` is false or `status` is `retry`, `failed`, `error`, `processing`, `running`,
or `pending`. A durable `queued`/`accepted` acknowledgment is allowed only when
the backend owns subsequent retries and delivery. Do not acknowledge volatile
background tasks. The relay's `sent` status means **backend acknowledged**, not
proof of delivery to Telegram.

SQLite plus HTTP cannot provide exactly-once delivery across a crash between
backend completion and local acknowledgment. The stable backend keys close that
gap; backend Telegram delivery still needs its own outbox/deduplication policy.
Do not run the Worker and relay together during a transport migration.

## Environment and files

Systemd reads **`/opt/coach-reachy/.env`**. Keep that file root-owned mode `0600`;
systemd passes its values to the `boxd` process. The Python CLI reads environment
variables, not the `.env` file itself. Do not print or put secret values in CLI
arguments or logs.

Required settings (same values as the backend):

| Setting | Purpose |
| --- | --- |
| `TELEGRAM_TRANSPORT=polling` | Explicitly enable fallback transport; other values refuse startup |
| `TELEGRAM_BOT_TOKEN` | Telegram bot credential |
| `TELEGRAM_CHAT_ID` | Optional legacy backend fallback; the relay uses the backend's effective target |
| `BOX_SHARED_SECRET` | Authenticate internal backend requests |
| `INTERVALS_API_KEY` | Intervals API credential, Basic auth username `API_KEY` |
| `INTERVALS_ATHLETE_ID` | Athlete to poll |
| `RELAY_START_DATE` | Optional earliest scheduled-report date, `YYYY-MM-DD` |

The timezone is always `Europe/Amsterdam`, independent of the host timezone.
`RELAY_START_DATE` controls morning/evening reports; activity detection starts
with the first successful baseline.

**`/opt/coach-reachy/state/relay.sqlite`** stores the initial start timestamp,
Telegram offset, pending authorized updates, sent/pending/expired jobs, retry
deadlines, and seen activity IDs. Preserve it across upgrades/restarts. Deleting
it deliberately resets the start boundary and activity baseline. Do not switch
bot/chat identity while reusing the previous bot's state.

The state directory must be `boxd:boxd`, mode `0700`; database and lock files are
mode `0600`. Pending authorized message payloads stay local until acknowledged
and are then deleted. Disallowed updates store only their update IDs. Job/seen-ID
history is kept for durable deduplication. Treat SQLite and its WAL/SHM sidecars
as private data; use SQLite backup or stop the service before copying them.
Logs contain generic outcomes only, with no message content, health data,
activity IDs, bot tokens, auth headers, webhook URLs, or remote exception text.

## Scheduling and retries

- **08:30 morning / 21:00 evening Amsterdam**, using IANA timezone rules for DST.
  Keys are `morning:YYYY-MM-DD` and `evening:YYYY-MM-DD`, identical to the Worker.
- First successful startup persists its timestamp after the webhook check.
  Only scheduled slots **strictly after** that timestamp are eligible. Starting
  at 10:00 does not send that morning's report; starting at 22:00 sends neither.
- Later restarts catch up only on eligible slots from the **current Amsterdam
  day**, at or after `RELAY_START_DATE` when configured. Yesterday's pending
  morning/evening jobs expire, with no historical replay. The backend must also
  avoid stale delivery if it accepts jobs into its own queue.
- Intervals is polled every **20 minutes**, with a persisted next-poll deadline,
  for the last three days (through tomorrow's exclusive date boundary). The
  first successful, valid response records a baseline and sends no reports.
  Subsequent newly observed IDs enqueue `activity:ID` with `activity_id=ID`.
  Queueing and recording seen IDs happen in one SQLite transaction. Restricted
  Intervals records still go to the backend as IDs; the relay invents no data.
- Failed jobs retry after 1, 2, 4, 8, 16, 32, then 60 minutes. Intervals/Telegram
  failures use the same persistent capped backoff. Pending activity jobs expire
  three days after detection. At most ten ready jobs are dispatched per pass.
- An exclusive `flock` on `relay.sqlite.lock` prevents overlapping processes
  using the same state path, including `--once`. Always use the canonical path.
  The kernel releases the lock on exit/crash; do not delete a live lock file.

## Telegram behavior

Before any work, `getWebhookInfo` must return an empty URL. An existing webhook
causes exit **78** without modifying it. A polling conflict (HTTP 409), including
a webhook installed during runtime, also stops the process. There is no
`deleteWebhook` or `setWebhook` code. See the
[Telegram polling and webhook contract](https://core.telegram.org/bots/api#getupdates).

Original private text messages are filtered using the effective target fetched
from the backend, including a fresh check before replaying the durable inbox.
Lookup failures retry with the offset preserved; they never use the stale env ID.
Groups, other chats, edits, callbacks, and unsupported messages are acknowledged
without forwarding their content.

Private `/start <token>` messages may reach the backend from any sender. Only the
backend can redeem the pairing capability; its 403 rejection is final and advances
the offset. Pairing tokens are never persisted in the relay's SQLite inbox. A
successful pairing refreshes the target for later messages in the same batch.
Ordinary authorized batches are saved before forwarding; transient failures stop
offset advancement and restart retries the saved batch. The backend rechecks the
exact private sender identity before queueing and before agent execution.

Pairing is initiated by a logged-in browser session using
`POST /api/telegram/pairing` (same-origin request), returning `{url, expires_at}`.
`GET /api/telegram` returns `{connected, bot_username, chat_id?}` for that session.
Service/API/MCP bearer credentials cannot issue pairing capabilities or read this
session endpoint. Migration `004_telegram_link.sql` persists the link and the hash
of a 32-character, single-use token expiring after ten minutes. Issuing a new token
invalidates the previous token and permits relinking. Redemption and the welcome
outbox entry commit atomically. Pending notifications resolve the database target
at send time. A legacy env target equal to the `getMe` bot ID is unlinked; no `.env`
change is required. Deploy backend migration and relay together; main owns rollout.

## Verification (no messages sent)

From the repository root, with `ops/requirements.txt` installed in your selected
Python environment:

```sh
python3 -m unittest discover -s ops/tests -v
python3 ops/relay.py --once --dry-run --state /tmp/coach-reachy-check/relay.sqlite
```

`--dry-run` is **offline and read-only**, needs no secrets, never instantiates an
HTTP client, never creates state, and never advances Telegram offsets. It prints
only eligible scheduled keys and aggregate pending counts. Missing state yields
no initial reports. Existing state is inspected read-only; retry/expiry changes
are not applied. It does not verify live credentials or backend availability.

`--once` **without** `--dry-run` is a live operation: it checks the webhook, runs
one scheduler/activity pass, and performs one nonblocking Telegram poll (or
retries an existing inbox). It may trigger backend sends. It uses the same lock,
state, and backoff as the daemon. A successful exit means the pass ran; per-item
transient failures remain pending and are logged for subsequent passes.

The tests use injected UTC clocks, temporary SQLite files, `httpx.MockTransport`,
and a socket connection guard. No live providers, secrets, or sends are used.
Coverage includes both DST transitions, first-start/start-date boundaries,
restart catch-up/expiry/dedup, baseline and poll timing, failed-update ordering,
durable inbox recovery, backoff, webhook refusal/conflict, private-chat filtering,
redacted failures, redirect rejection, offline dry runs, concurrency, and shutdown.

## Installation handoff (operator/main agent only)

The VM must stay awake while this fallback is active: a process on a suspended
VM cannot receive Telegram traffic or wake itself for a schedule. Configure VM
lifecycle outside this directory. This service opens no listening port.

After copying `ops/` under `/opt/coach-reachy`, setting the `.env` values above,
and making the authenticated backend available:

```sh
sudo install -d -o boxd -g boxd -m 0700 /opt/coach-reachy/state
sudo python3 -m venv /opt/coach-reachy/ops/.venv
sudo /opt/coach-reachy/ops/.venv/bin/python -m pip install -r /opt/coach-reachy/ops/requirements.txt
sudo install -m 0644 /opt/coach-reachy/ops/coach-reachy-relay.service /etc/systemd/system/coach-reachy-relay.service
sudo systemd-analyze verify /etc/systemd/system/coach-reachy-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now coach-reachy-relay.service
```

The unit mounts the application read-only except for `state/`, drops
capabilities, and runs without privilege escalation. Ensure `boxd` can traverse
and read `ops/` and its venv. No access to `/home/boxd` is required by this service;
the backend owns OpenRouter credentials and coaching execution.

Exit codes: `0` clean completion, `1` fatal internal/startup connectivity failure,
`75` lock already held, `78` invalid config/webhook/polling conflict. Systemd
restarts ordinary failures after 60 seconds, but does not restart codes 75/78.
Fix the underlying conflict/configuration before an explicit service restart.

For a Cloudflare cutover, stop this service first, preserve SQLite, then let the
main agent establish the intended webhook and Worker schedule. Never remove an
existing webhook automatically to make the fallback start.

Weekly coaching is queued Sundays at 20:00 Europe/Amsterdam (DST-aware), in addition to
morning/evening reports. Both the VM relay and Worker use `weekly:YYYY-MM-DD` keys;
the backend deduplicates overlap and routes the request through the same read-only weekly
brief as on-demand chat. The existing 20-minute Worker cron covers this slot. Changes
require the normal deployment process; implementing this trigger does not deploy it.
