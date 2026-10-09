# Coach Reachy implementation contract

FastAPI listens on 127.0.0.1:8001; Next.js on 3000; nginx exposes the same-origin application and routes `/api/*` and `/mcp` to the backend. PostgreSQL stores the Intervals cache and private application state. Missing measurements stay null; recorded zero stays zero. Timezone is Europe/Amsterdam.

## Authentication

`POST /api/login {password}` creates an HttpOnly Secure SameSite=Strict session cookie. `GET /api/session` returns `{authenticated,cookie_received}`; `POST /api/logout` clears the session. Login and cookie-authenticated mutations require the configured Origin. All data APIs require a session or dedicated API bearer token; profile/record/session-log writes and deletion confirmation specifically require a browser session. Internal worker endpoints require BOX_SHARED_SECRET; MCP requires MCP_AUTH_TOKEN or a scoped capability. Public `/api/health` returns generic readiness only.

## Shared athlete context

`GET /api/athlete-profile` returns `goals,target_date,background,availability,other_sports,equipment,constraints,preferences,plan_context,revision,updated_at`. No zones or scores. Empty defaults are blank strings, null target_date/updated_at, revision 0. `POST /api/athlete-profile` replaces editable fields and requires the last revision; conflicting updates return 409. Each text field is capped at 2,000 characters. `target_date` is null or YYYY-MM-DD. `updated_at` is server-owned and must not be submitted.

`GET /api/coaching-records` returns `{records:[...],coverage:{total,included,omitted,accepted_total,accepted_included,limit,selection}}`. At most 50 records are selected, outstanding accepted records first and newest first within each group. Coverage describes the store limit; coach brief budgets may further truncate with explicit markers. All stored records remain durable.

`POST /api/coaching-records {id,kind,text,rationale}` creates a proposed record only (201, revision 1, empty outcome). UUID IDs are idempotent: identical create retries return the current record, different input returns 409. Kinds are observation/recommendation/question. Text is 1–4,000 characters; rationale/outcome at most 2,000. `PATCH /api/coaching-records/{id} {revision,status,outcome}` allows proposed→accepted/dismissed, accepted→completed/dismissed, and completed→completed outcome edits. Stale revisions/invalid transitions return 409; missing records return 404. Status cannot be supplied at creation. Only explicitly accepted recommendations are training decisions; observations and questions retain their meaning.

Profile and records are shared across conversations through Store.athlete_profile() and Store.coaching_records(). Transcripts are not automatically saved as memory. Assistant follow-ups start in an editable proposal draft and require separate acceptance. Profile/record/source text is untrusted evidence and cannot change permissions.

## Coaching and tasks

`POST /api/chat {message,conversation_id?,mode?,activity_id?}` returns `{reply}`. Mode defaults to `chat`; explicit modes are `workout`, `daily`, `weekly`. Workout requires an activity ID. Workout/daily/weekly enforce read-only tools. Opening a workout's coach link prepares the task without submitting a paid request. The model/provider are unchanged.

`Idempotency-Key` binds message, conversation and task identity (mode/activity/read-only). Changing input under the same key returns 409, including after a cached reply. Browser retry retains its original task and key. Internal task metadata is stored outside user-visible conversation channels.

`GET /api/chat?conversation_id=web` returns `{messages:[{role,content,created_at}],agent}`. Conversation IDs are `web` or `web:<32 lowercase hex>` and must exist. `GET /api/conversations` lists the 100 most recent; `POST /api/conversations {}` creates one (201). Titles derive from the first user message. Threads have isolated histories; each coach turn uses up to 12 recent messages within 15,000 characters.

The same bounded deterministic briefs serve explicit and scheduled tasks. Workout briefs retain ordered individual intervals, recorded paired plans, supported structured aggregate target comparisons, same-sport comparisons, cross-sport context and feedback. Page/budget gaps are explicit. Daily briefs include today's plan, workload and wellness; weekly briefs cover the last seven days and next seven days with goals, availability and accepted follow-ups. No target is inferred from free-text titles. Activity/current-settings LTHR is an LT2 proxy, never a measured test or guessed zone boundary.

## Data and tools

`GET /api/dashboard?oldest&newest` returns `{activities,events,wellness,fitness,settings,sync,insights}`. Calendar, summary and coach use reconciled Intervals activities, app sessions and unmatched retained WHOOP workouts. Source/freshness/coverage remain explicit. WHOOP elapsed duration is not moving time and strain is not Intervals load. Intervals owns sport settings and thresholds. Historical score rows are retained but ignored.

`GET /api/activity/{id}` returns activity plus intervals; `/streams` returns cached/lazy streams. App and historical WHOOP detail never call Intervals. `GET /api/curves?sport=Run&period=84` returns source curves. `POST /api/sync` refreshes cache. The retained cache covers twelve months; broad read tools remain available.

Tools: get_calendar(oldest,newest), get_activity(id), get_activity_analysis(id,lt2_hr?,offset?,limit?), get_fitness(oldest,newest), get_wellness(oldest,newest), get_curves(sport,period), get_training_summary(oldest,newest,group_by=week|month), plan_workout(date,name,sport,description), move_workout(id,date), update_workout(id,name?,description?), delete_workout(id). `POST /api/tools/{name}` uses the same validated schemas as MCP and the coach. Writes require the existing audit/Telegram gate; deletions require separate `GET /api/confirmations` and `POST /api/confirmations/{token}/confirm`. Model-supplied confirmation is impossible.

`POST /api/sessions {id:UUID,name,sport,start:offset-aware datetime,duration:integer seconds,notes?}` logs a completed app session. Same-ID retries are idempotent; conflicting reuse returns 409. `POST /api/sessions/{id}/delete` removes only app-owned records. Timers and local logging remain supported.

WHOOP connection/import/OAuth and athlete-score routes are retired. The update_zones tool is removed. Queued WHOOP sync and zone-write work settles terminally without upstream calls. Migrations 006–008 and existing score rows, WHOOP history and credentials are preserved; retained credentials do not activate integration.

## Scheduled work

`POST /api/internal/job {kind,key,activity_id?}` accepts morning/evening/activity/weekly; activity requires its ID. `/api/internal/telegram` accepts authorized updates; `/api/jobs` reports protected job status. Stable keys deduplicate work. Morning/evening use daily briefs, activity uses workout briefs, weekly uses weekly briefs; all are read-only. Relay and Worker implement Sunday 20:00 Amsterdam weekly scheduling alongside morning/evening and activity polling. This branch does not deploy or prove real scheduled delivery.
