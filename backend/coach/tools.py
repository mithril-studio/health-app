import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from psycopg.types.json import Jsonb

from coach.intervals import UpstreamError
from coach.models import READ_TOOLS, validate_tool
from coach.sync import SyncService


class ToolError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def event_snapshot(event):
    # Volatile fitness and server timestamps must not invalidate a confirmation.
    return {
        k: event.get(k)
        for k in ("id", "name", "category", "start_date_local", "description", "type")
    }


class ToolService:
    def __init__(self, store, source, *, telegram_configured=False):
        self.store, self.source = store, source
        self.sync = SyncService(store, source)
        self.telegram_configured = telegram_configured

    async def call(self, name, arguments, *, read_only=False, operation_key=None):
        args = validate_tool(name, arguments)
        if read_only and name not in READ_TOOLS:
            raise ToolError("Writes are disabled for scheduled advice", 403)
        values = args.model_dump(mode="json", exclude_none=True)
        if name == "get_calendar":
            return {
                "activities": await self.store.range("activities", args.oldest, args.newest),
                "events": await self.store.range("events", args.oldest, args.newest),
            }
        if name in ("get_fitness", "get_wellness"):
            return await self.store.range(
                "fitness_daily" if name == "get_fitness" else "wellness", args.oldest, args.newest
            )
        if name == "get_activity":
            return await self.activity(args.id)
        if name == "get_curves":
            key = f"{args.sport}:{args.period}"
            data = await self.store.get("curve_cache", key, max_age=3600)
            if data is None:
                data = await self.source.curves(args.sport, args.period)
                await self.store.put("curve_cache", key, data)
            return data
        if not self.telegram_configured:
            raise ToolError(
                "Telegram must be configured before writes can be audited and echoed", 503
            )
        operation_id = operation_key or uuid.uuid4().hex
        existing = await self.store.query(
            "SELECT name,args FROM write_operations WHERE id=%s", (operation_id,), one=True
        )
        if existing:
            if existing["name"] != name or existing["args"] != values:
                raise ToolError("Idempotency key already used for different input", 409)
            return await self.execute_write(operation_id)
        if name == "delete_workout":
            return await self.request_delete(args.id, operation_id)
        method, path, body = "PUT", "", {}
        if name == "plan_workout":
            method, path = "POST", "events"
            # The UID is stable even if a timeout happens after Intervals committed.
            uid = "coach-reachy-" + hashlib.sha256(operation_id.encode()).hexdigest()
            body = {
                "uid": uid,
                "category": "WORKOUT",
                "start_date_local": f"{args.date}T00:00:00",
                "name": args.name,
                "type": args.sport,
                "description": args.description,
            }
        elif name in ("move_workout", "update_workout"):
            event = await self.editable_event(args.id)
            path = f"events/{args.id}"
            if name == "move_workout":
                time = (event.get("start_date_local") or "T00:00:00").partition("T")[
                    2
                ] or "00:00:00"
                body = {"start_date_local": f"{args.date}T{time}"}
            else:
                body = {k: v for k, v in values.items() if k in ("name", "description")}
        elif name == "update_zones":
            settings = await self.store.settings()
            if args.sport not in settings:
                for row in await self.source.settings():
                    await self.store.put("sport_settings", row["id"], row)
                settings = await self.store.settings()
            setting = settings.get(args.sport)
            if not setting:
                raise ToolError("No matching sport settings exist", 404)
            path = f"sport-settings/{setting['id']}"
            body = {k: v for k, v in values.items() if k != "sport"}
        await self.prepare_write(operation_id, name, values, method, path, body)
        return await self.execute_write(operation_id)

    async def activity(self, id, streams=False):
        row = await self.store.get("activities", id)
        if row is None:
            # Restrict lazy activity access to this athlete's cached index.
            await self.sync.run()
            row = await self.store.get("activities", id)
        if row is None:
            raise ToolError("Activity not found in the athlete cache", 404)
        table = "activity_streams" if streams else "activity_intervals"
        data = await self.store.get(table, id)
        if data is None:
            try:
                data = await (self.source.streams(id) if streams else self.source.intervals(id))
            except UpstreamError as exc:
                if exc.status not in (403, 404, 422):
                    raise
                # Restricted source records are real; don't substitute invented detail.
                data = {"available": False, "reason": "Source does not expose this activity detail"}
            await self.store.put(table, id, data)
        return data if streams else {**row, "intervals": data}

    async def editable_event(self, id):
        event = await self.source.event(id)
        if event.get("category") != "WORKOUT" or event.get("athlete_cannot_edit"):
            raise ToolError("Only editable planned workouts can be changed", 409)
        return event

    async def request_delete(self, id, operation_id):
        event = await self.editable_event(id)
        await self.store.execute(
            "INSERT INTO pending_deletions(token,event_id,snapshot,expires_at,operation_id) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(operation_id) DO NOTHING",
            (
                secrets.token_urlsafe(32),
                id,
                Jsonb(event_snapshot(event)),
                datetime.now(UTC) + timedelta(minutes=10),
                operation_id,
            ),
        )
        pending = await self.store.query(
            "SELECT event_id FROM pending_deletions WHERE operation_id=%s",
            (operation_id,),
            one=True,
        )
        if pending["event_id"] != id:
            raise ToolError("Idempotency key already used for different input", 409)
        # The model never sees a confirmation capability. Only the session-authenticated
        # user-facing list exposes the opaque token; it cannot be confirmed by an MCP tool.
        return {
            "pending_confirmation": True,
            "message": "Confirm deletion in the Coach Reachy web app within 10 minutes.",
        }

    async def pending_deletions(self):
        rows = await self.store.query(
            "SELECT token,event_id,snapshot,expires_at FROM pending_deletions WHERE status='pending' AND expires_at>now() ORDER BY created_at"
        )
        return rows

    async def confirm_delete(self, token):
        async with self.store.lock("confirmation:" + token, wait=True) as conn:
            row = await self.store.query(
                "SELECT *,expires_at>now() AS valid FROM pending_deletions WHERE token=%s",
                (token,),
                conn=conn,
                one=True,
            )
            if not row:
                raise ToolError("Confirmation not found", 404)
            if row["status"] == "done":
                return {"status": "done"}
            if row["status"] == "pending":
                if not row["valid"]:
                    raise ToolError("Confirmation expired; request deletion again", 409)
                event = await self.editable_event(row["event_id"])
                if event_snapshot(event) != row["snapshot"]:
                    raise ToolError("Workout changed; request a new deletion confirmation", 409)
                async with conn.transaction():
                    await self.prepare_write(
                        row["operation_id"],
                        "delete_workout",
                        {"id": row["event_id"]},
                        "DELETE",
                        f"events/{row['event_id']}",
                        {},
                        conn=conn,
                    )
                    await conn.execute(
                        "UPDATE pending_deletions SET status='confirmed' WHERE token=%s", (token,)
                    )
            await self.execute_write(row["operation_id"])
            await conn.execute(
                "UPDATE pending_deletions SET status='done' WHERE token=%s", (token,)
            )
        return {"status": "done"}

    async def prepare_write(self, id, name, args, method, path, body, conn=None):
        if conn is None:
            async with self.store.pool.connection() as c, c.transaction():
                return await self.prepare_write(id, name, args, method, path, body, conn=c)
        await conn.execute(
            "INSERT INTO write_operations(id,name,args,remote_body,path,method) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (id, name, Jsonb(args), Jsonb(body), path, method),
        )
        # Validate conflicts inside the transaction too, including concurrent callers.
        existing = await self.store.query(
            "SELECT name,args FROM write_operations WHERE id=%s", (id,), conn=conn, one=True
        )
        if existing["name"] != name or existing["args"] != args:
            raise ToolError("Idempotency key already used for different input", 409)
        await conn.execute(
            "INSERT INTO write_audit(operation_id,action) VALUES (%s,'requested') ON CONFLICT DO NOTHING",
            (id,),
        )
        await self.store.enqueue("write:" + id, "write", {"operation_id": id}, conn=conn)

    async def execute_write(self, id):
        async with self.store.lock("sync", wait=True):
            return await self._execute_write_locked(id)

    async def _execute_write_locked(self, id):
        async with self.store.lock("write:" + id, wait=True) as conn:
            row = await self.store.query(
                "SELECT * FROM write_operations WHERE id=%s", (id,), one=True, conn=conn
            )
            if row["status"] == "done":
                return row["result"]
            if row["status"] == "pending":
                # PUT/DELETE are idempotent; POST events has an explicit upstream UID upsert.
                # Retry ownership belongs to the durable queue, never the HTTP transport.
                try:
                    result = await self.source.request(
                        row["method"],
                        row["path"],
                        json=row["remote_body"] if row["method"] != "DELETE" else None,
                        params={"upsertOnUid": "true"} if row["method"] == "POST" else None,
                    )
                except UpstreamError as exc:
                    if row["method"] == "DELETE" and exc.status == 404:
                        result = {}
                    elif 400 <= exc.status < 500 and exc.status not in (408, 429):
                        await conn.execute(
                            "UPDATE write_operations SET status='rejected',error=%s WHERE id=%s",
                            (f"upstream_{exc.status}", id),
                        )
                        raise ToolError("Intervals rejected the write", 422) from None
                    else:
                        raise
                async with conn.transaction():
                    await conn.execute(
                        "UPDATE write_operations SET status='applied',result=%s,updated_at=now() WHERE id=%s",
                        (Jsonb(result), id),
                    )
                    await conn.execute(
                        "INSERT INTO write_audit(operation_id,action) VALUES (%s,'applied') ON CONFLICT DO NOTHING",
                        (id,),
                    )
                    summary = json.dumps(
                        {"action": row["name"], "arguments": row["args"]}, ensure_ascii=False
                    )
                    await self.store.enqueue(
                        "echo:" + id,
                        "notification",
                        {"text": "Coach Reachy updated Intervals:\n" + summary},
                        conn=conn,
                    )
                row["result"], row["status"] = result, "applied"
            if row["status"] == "rejected":
                raise ToolError(
                    "Intervals rejected the write; review the request before trying again", 422
                )
            # A refresh failure must never reapply an already committed remote write.
            if row["name"] == "update_zones":
                settings = await self.source.settings()
                async with conn.transaction():
                    await conn.execute("DELETE FROM sport_settings")
                    for setting in settings:
                        await self.store.put("sport_settings", setting["id"], setting, conn=conn)
            elif row["method"] == "DELETE":
                await conn.execute("DELETE FROM events WHERE id=%s", (row["args"]["id"],))
            else:
                event_id = row["result"].get("id") or row["args"].get("id")
                if not event_id:
                    raise ToolError("Remote write needs reconciliation", 502)
                event = await self.source.event(event_id)
                await self.store.put(
                    "events", event_id, event, event["start_date_local"][:10], conn=conn
                )
                row["result"] = event
            await conn.execute(
                "UPDATE write_operations SET status='done',result=%s,error=NULL,updated_at=now() WHERE id=%s",
                (Jsonb(row["result"]), id),
            )
            return row["result"]
