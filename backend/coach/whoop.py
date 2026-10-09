"""Official WHOOP v2 workouts. Credentials stay in private server-side storage."""

import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from pydantic import Field

from coach.auth import digest
from coach.models import StrictModel
from coach.tools import ToolError

API = "https://api.prod.whoop.com/developer/v2"
OAUTH = "https://api.prod.whoop.com/oauth/oauth2"


class OAuthInput(StrictModel):
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=8, max_length=128)


def normalize_workout(raw):
    start, end = datetime.fromisoformat(raw["start"]), datetime.fromisoformat(raw["end"])
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Invalid WHOOP timestamps")
    score = raw.get("score") or {}
    sport = raw.get("sport_name") or "Other"
    return {
        "id": "whoop-" + str(raw["id"]),
        "source": "whoop",
        "name": sport.replace("_", " ").title(),
        "type": sport,
        "start_date": start.isoformat(),
        "start_date_local": start.astimezone(ZoneInfo("Europe/Amsterdam")).isoformat(),
        "elapsed_time": int((end - start).total_seconds()),
        # WHOOP gives elapsed duration, not moving time; retain that distinction.
        "session_duration": int((end - start).total_seconds()),
        "average_heartrate": score.get("average_heart_rate"),
        "distance": score.get("distance_meter"),
        "whoop_strain": score.get("strain"),
        "score_state": raw.get("score_state"),
    }


class Whoop:
    def __init__(self, cfg, store, client):
        self.cfg, self.store, self.client = cfg, store, client

    @property
    def configured(self):
        return bool(self.cfg.whoop_client_id and self.cfg.whoop_client_secret.get_secret_value())

    @property
    def redirect_uri(self):
        return self.cfg.app_origin + "/settings"

    async def status(self):
        row = await self.store.query(
            "SELECT last_success,error FROM whoop_connection WHERE id=1", one=True
        )
        return {
            "configured": self.configured,
            "connected": row is not None,
            "last_success": row["last_success"] if row else None,
            "error": row["error"] if row else None,
        }

    async def authorize(self, session_token):
        if not self.configured:
            raise ToolError("WHOOP needs server configuration", 503)
        state = secrets.token_urlsafe(32)
        async with self.store.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "DELETE FROM whoop_oauth_states WHERE expires_at<now() OR session_hash=%s",
                (digest(session_token),),
            )
            await conn.execute(
                "INSERT INTO whoop_oauth_states VALUES (%s,%s,now()+interval '10 minutes')",
                (digest(state), digest(session_token)),
            )
        return {
            "url": OAUTH
            + "/auth?"
            + urlencode(
                {
                    "client_id": self.cfg.whoop_client_id,
                    "redirect_uri": self.redirect_uri,
                    "response_type": "code",
                    "scope": "read:workout offline",
                    "state": state,
                }
            )
        }

    async def exchange(self, values, conn):
        try:
            response = await self.client.post(
                OAUTH + "/token",
                data={
                    "client_id": self.cfg.whoop_client_id,
                    "client_secret": self.cfg.whoop_client_secret.get_secret_value(),
                    **values,
                },
                timeout=20,
            )
            response.raise_for_status()
            token = response.json()
            if not token.get("access_token") or not token.get("refresh_token"):
                raise ValueError("Missing token")
            expires = datetime.now(UTC) + timedelta(seconds=int(token["expires_in"]))
            await conn.execute(
                "INSERT INTO whoop_connection(id,access_token,refresh_token,expires_at) VALUES (1,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,error=NULL",
                (token["access_token"], token["refresh_token"], expires),
            )
            return token["access_token"]
        except (httpx.HTTPError, ValueError, KeyError):
            raise ToolError("WHOOP authorization failed. Please reconnect.", 502) from None

    async def connect(self, body, session_token):
        async with self.store.lock("whoop", wait=True) as conn:
            state = await self.store.query(
                "DELETE FROM whoop_oauth_states WHERE state_hash=%s AND session_hash=%s AND expires_at>now() RETURNING state_hash",
                (digest(body.state), digest(session_token)),
                conn=conn,
                one=True,
            )
            if not state:
                raise ToolError("WHOOP sign-in expired. Start again.", 400)
            # Reconnecting must not silently mix two WHOOP accounts.
            async with conn.transaction():
                await self.exchange(
                    {
                        "grant_type": "authorization_code",
                        "code": body.code,
                        "redirect_uri": self.redirect_uri,
                    },
                    conn,
                )
                await conn.execute("DELETE FROM whoop_workouts")
                await conn.execute("UPDATE whoop_connection SET last_success=NULL WHERE id=1")
        return await self.status()

    async def access_token(self, row, conn, *, force=False):
        if force or row["expires_at"] <= datetime.now(UTC) + timedelta(seconds=60):
            return await self.exchange(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": row["refresh_token"],
                    "scope": "offline",
                },
                conn,
            )
        return row["access_token"]

    async def sync(self):
        if not self.configured:
            return {"connected": False}
        async with self.store.lock("whoop", wait=True) as conn:
            row = await self.store.query(
                "SELECT * FROM whoop_connection WHERE id=1", conn=conn, one=True
            )
            if not row:
                return {"connected": False}
            try:
                token = await self.access_token(row, conn)
                # Full 90-day window reconciles edits/deletions and later Garmin arrivals.
                now = datetime.now(UTC)
                oldest = now.astimezone(ZoneInfo("Europe/Amsterdam")).date() - timedelta(days=90)
                start = datetime.combine(oldest, datetime.min.time(), ZoneInfo("Europe/Amsterdam"))
                params = {"start": start.isoformat(), "end": now.isoformat(), "limit": 25}
                records, seen = [], set()
                for _ in range(400):
                    response = await self.client.get(
                        API + "/activity/workout",
                        params=params,
                        headers={"Authorization": "Bearer " + token},
                        timeout=20,
                    )
                    if response.status_code == 401:
                        current = await self.store.query(
                            "SELECT * FROM whoop_connection WHERE id=1", conn=conn, one=True
                        )
                        token = await self.access_token(current, conn, force=True)
                        response = await self.client.get(
                            API + "/activity/workout",
                            params=params,
                            headers={"Authorization": "Bearer " + token},
                            timeout=20,
                        )
                    response.raise_for_status()
                    page = response.json()
                    records.extend(normalize_workout(r) for r in page["records"])
                    next_token = page.get("next_token")
                    if not next_token:
                        break
                    if next_token in seen:
                        raise ValueError("Repeated pagination cursor")
                    seen.add(next_token)
                    params["nextToken"] = next_token
                else:
                    raise ValueError("Pagination limit exceeded")
                async with conn.transaction():
                    await self.store.replace_range(
                        "whoop_workouts", records, oldest, now.date() + timedelta(days=1), conn
                    )
                    await conn.execute(
                        "UPDATE whoop_connection SET last_success=now(),error=NULL WHERE id=1"
                    )
            except Exception:
                await conn.execute(
                    "UPDATE whoop_connection SET error='WHOOP sync failed. Retry or reconnect.' WHERE id=1"
                )
                raise ToolError("WHOOP sync failed. Retry or reconnect.", 502) from None
        return {"connected": True, "imported": len(records)}

    async def disconnect(self):
        async with self.store.lock("whoop", wait=True) as conn:
            row = await self.store.query(
                "SELECT * FROM whoop_connection WHERE id=1", conn=conn, one=True
            )
            if row:
                token = await self.access_token(row, conn)
                try:
                    response = await self.client.delete(
                        API + "/user/access",
                        headers={"Authorization": "Bearer " + token},
                        timeout=20,
                    )
                    if response.status_code != 401:
                        response.raise_for_status()
                except httpx.HTTPError:
                    raise ToolError("Could not disconnect WHOOP. Please retry.", 502) from None
            async with conn.transaction():
                await conn.execute("DELETE FROM whoop_connection")
                await conn.execute("DELETE FROM whoop_oauth_states")
        return {"connected": False}  # Imported history is retained.
