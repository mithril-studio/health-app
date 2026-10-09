# ruff: noqa: F811
import asyncio
from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from test_guards import web  # noqa: F401

from coach.config import Settings
from coach.sessions import combined_activities, duplicate_of
from coach.tools import ToolError
from coach.whoop import OAuthInput, Whoop, normalize_workout


def session(**kwargs):
    return {
        "id": str(uuid4()),
        "name": "Evening reset",
        "sport": "Stretching",
        "start": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        "duration": 300,
        **kwargs,
    }


async def login(client):
    client.headers["Origin"] = "https://coach.test"
    assert (
        await client.post("/api/login", json={"password": "correct-password"})
    ).status_code == 200


async def test_sessions_require_user_origin_and_validate_completed_data(web):
    c, _ = web
    assert (await c.post("/api/sessions", json=session())).status_code == 401
    assert (
        await c.post(
            "/api/sessions", json=session(), headers={"Authorization": "Bearer api-secret"}
        )
    ).status_code == 403
    await login(c)
    for payload in [
        session(duration=-1),
        session(duration=2.5),
        session(sport="invented"),
        session(start="2026-10-01T10:00:00"),
        session(start=(datetime.now(UTC) + timedelta(hours=1)).isoformat()),
    ]:
        assert (await c.post("/api/sessions", json=payload)).status_code == 422
    del c.headers["Origin"]
    assert (await c.post("/api/sessions", json=session())).status_code == 403


async def test_session_retry_concurrent_dedup_calendar_coach_and_sync_survival(web, store):
    c, app = web
    await login(c)
    payload = session(sport="HomeWorkout")
    responses = await asyncio.gather(*(c.post("/api/sessions", json=payload) for _ in range(4)))
    assert all(r.status_code == 201 for r in responses)
    assert len(await store.query("SELECT * FROM local_sessions")) == 1
    assert (await c.post("/api/sessions", json={**payload, "name": "changed"})).status_code == 409
    await app.state.tools.sync.run()
    day = responses[0].json()["start_date_local"][:10]
    dashboard = (await c.get(f"/api/dashboard?oldest={day}&newest={day}")).json()
    identifier = "local-" + payload["id"]
    assert any(r["id"] == identifier for r in dashboard["activities"])
    coach = await app.state.tools.call("get_calendar", {"oldest": day, "newest": day})
    assert coach["activities"] == dashboard["activities"]
    detail = (await c.get("/api/activity/" + identifier)).json()
    assert detail["source"] == "app" and detail["intervals"] == []
    assert "icu_training_load" not in detail
    analysis = await app.state.tools.call("get_activity_analysis", {"id": identifier})
    assert analysis["activity"]["source"] == "app"
    assert analysis["intervals"] == []
    assert analysis["session"]["above_lt2_seconds"] is None
    assert (await c.post(f"/api/sessions/{identifier}/delete")).status_code == 200
    assert (await c.get("/api/activity/" + identifier)).status_code == 404


def workout(**kwargs):
    stamp = datetime.now(UTC).replace(hour=8, minute=0, second=0, microsecond=0) - timedelta(days=1)
    return {
        "id": "synthetic-whoop",
        "start": stamp.isoformat(),
        "end": (stamp + timedelta(hours=1)).isoformat(),
        "sport_name": "running",
        "score_state": "SCORED",
        "score": {"strain": 12.5, "average_heart_rate": 140},
        **kwargs,
    }


def test_whoop_normalization_does_not_invent_load_distance_or_moving_time():
    result = normalize_workout(workout())
    assert result["elapsed_time"] == result["session_duration"] == 3600
    assert result["distance"] is None
    assert "moving_time" not in result and "icu_training_load" not in result
    assert result["whoop_strain"] == 12.5
    pending = normalize_workout(workout(score=None, score_state="PENDING_SCORE"))
    assert pending["average_heartrate"] is None


def test_matching_requires_similar_sport_start_and_duration_and_handles_dst():
    w = normalize_workout(
        workout(start="2026-10-25T01:30:00+00:00", end="2026-10-25T02:30:00+00:00")
    )
    primary = {
        "id": "garmin",
        "type": "Run",
        "start_date": "2026-10-25T01:32:00Z",
        "elapsed_time": 3550,
    }
    assert duplicate_of(w, [primary]) == "garmin"
    assert (
        duplicate_of({**w, "type": "weightlifting"}, [{**primary, "type": "WeightTraining"}])
        == "garmin"
    )
    assert duplicate_of(w, [{**primary, "type": "Soccer"}]) is None
    assert duplicate_of(w, [{**primary, "elapsed_time": 600}]) is None
    assert duplicate_of(w, [{"id": "restricted", "start_date_local": "2026-10-25"}]) is None
    assert duplicate_of(w, [{**primary, "start_date": "2026-10-25T02:31:00Z"}]) is None


async def test_late_garmin_arrival_reconciles_without_deleting_whoop(store):
    w = normalize_workout(workout())
    day = date.fromisoformat(w["start_date_local"][:10])
    await store.put("whoop_workouts", w["id"], w, day)
    assert len(await combined_activities(store, day, day)) == 1
    primary = {**w, "id": "garmin", "source": "intervals", "type": "Run"}
    await store.put("activities", primary["id"], primary, day)
    assert [r["id"] for r in await combined_activities(store, day, day)] == ["garmin"]
    assert (await combined_activities(store, day, day, review=True))[0]["duplicate_of"] == "garmin"
    assert await store.get("whoop_workouts", w["id"])


def service(store, handler):
    cfg = Settings(
        _env_file=None,
        app_origin="https://coach.test",
        whoop_client_id="client",
        whoop_client_secret="secret",
    )
    return Whoop(cfg, store, httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def seed_token(store, expired=False):
    await store.execute(
        "INSERT INTO whoop_connection VALUES (1,'access','refresh',%s,NULL,NULL)",
        (datetime.now(UTC) + timedelta(hours=-1 if expired else 1),),
    )


async def test_oauth_bound_to_session_single_use_and_no_tokens_in_status(store):
    calls = []

    async def handler(req):
        calls.append(req)
        return httpx.Response(
            200,
            json={
                "access_token": "private-access",
                "refresh_token": "private-refresh",
                "expires_in": 3600,
            },
        )

    svc = service(store, handler)
    try:
        url = (await svc.authorize("session-a"))["url"]
        params = parse_qs(urlsplit(url).query)
        assert params["scope"] == ["read:workout offline"]
        body = OAuthInput(code="code", state=params["state"][0])
        with pytest.raises(ToolError):
            await svc.connect(body, "session-b")
        assert calls == []
        await svc.connect(body, "session-a")
        with pytest.raises(ToolError):
            await svc.connect(body, "session-a")
        assert len(calls) == 1
        assert "private" not in str(await svc.status())
        url = (await svc.authorize("session-a"))["url"]
        await store.execute("UPDATE whoop_oauth_states SET expires_at=now()-interval '1 second'")
        with pytest.raises(ToolError):
            await svc.connect(
                OAuthInput(code="code", state=parse_qs(urlsplit(url).query)["state"][0]),
                "session-a",
            )
    finally:
        await svc.client.aclose()


async def test_whoop_pagination_rotating_refresh_and_concurrent_sync(store):
    await seed_token(store, expired=True)
    refreshes = []

    async def handler(req):
        if req.url.path.endswith("/token"):
            refreshes.append(req)
            return httpx.Response(
                200, json={"access_token": "new", "refresh_token": "rotated", "expires_in": 3600}
            )
        assert req.headers["Authorization"] == "Bearer new"
        if req.url.params.get("nextToken") == "page2":
            return httpx.Response(200, json={"records": [workout(id="second")], "next_token": None})
        return httpx.Response(200, json={"records": [workout()], "next_token": "page2"})

    svc = service(store, handler)
    try:
        result = await asyncio.gather(svc.sync(), svc.sync())
        assert all(r["imported"] == 2 for r in result)
        assert len(refreshes) == 1
        assert len(await store.query("SELECT * FROM whoop_workouts")) == 2
        assert (await store.query("SELECT refresh_token FROM whoop_connection", one=True))[
            "refresh_token"
        ] == "rotated"
    finally:
        await svc.client.aclose()


async def test_failed_page_preserves_cache_and_success_cursor_then_reconciles_deletions(store):
    await seed_token(store)
    w = normalize_workout(workout())
    await store.put("whoop_workouts", w["id"], w, w["start_date_local"][:10])

    async def handler(req):
        if req.url.params.get("nextToken"):
            return httpx.Response(429, json={"error": "private upstream data"})
        return httpx.Response(200, json={"records": [workout(id="new")], "next_token": "next"})

    svc = service(store, handler)
    try:
        with pytest.raises(ToolError):
            await svc.sync()
        assert await store.get("whoop_workouts", w["id"])
        assert await store.get("whoop_workouts", "whoop-new") is None
        status = await svc.status()
        assert status["last_success"] is None and "private" not in status["error"]
    finally:
        await svc.client.aclose()
    svc = service(store, lambda req: httpx.Response(200, json={"records": [], "next_token": None}))
    try:
        await svc.sync()
        assert not await store.query("SELECT * FROM whoop_workouts")
        assert (await svc.status())["last_success"] is not None
    finally:
        await svc.client.aclose()


async def test_whoop_routes_are_session_only_and_connect_rejects_invalid_state(web):
    c, _ = web
    for method, path, body in [
        ("GET", "/api/whoop", None),
        ("POST", "/api/whoop/authorize", {}),
        ("POST", "/api/whoop/connect", {"code": "code", "state": "untrusted-state"}),
        ("POST", "/api/whoop/sync", {}),
        ("POST", "/api/whoop/disconnect", {}),
    ]:
        response = await c.request(
            method, path, json=body, headers={"Authorization": "Bearer api-secret"}
        )
        assert response.status_code == 403
    await login(c)
    assert (
        await c.post("/api/whoop/connect", json={"code": "code", "state": "untrusted-state"})
    ).status_code == 400
    assert (await c.get("/api/whoop")).json()["configured"] is False


async def test_disconnect_revokes_access_retains_history_and_stops_sync(store):
    await seed_token(store)
    w = normalize_workout(workout())
    await store.put("whoop_workouts", w["id"], w, w["start_date_local"][:10])
    requests = []

    async def handler(req):
        requests.append(req)
        assert req.method == "DELETE" and req.url.path.endswith("/user/access")
        return httpx.Response(204)

    svc = service(store, handler)
    try:
        await svc.disconnect()
        assert not (await svc.status())["connected"]
        assert await store.get("whoop_workouts", w["id"])
        assert (await svc.sync()) == {"connected": False}
        assert len(requests) == 1
    finally:
        await svc.client.aclose()
