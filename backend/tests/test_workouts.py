# ruff: noqa: F811
import asyncio
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from test_guards import web  # noqa: F401

from coach.sessions import combined_activities, duplicate_of


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
    # get_calendar returns compacted, training-relevant fields; the dashboard keeps raw records.
    coach_entry = next(r for r in coach["activities"] if r["id"] == identifier)
    dash_entry = next(r for r in dashboard["activities"] if r["id"] == identifier)
    assert all(dash_entry.get(k) == v for k, v in coach_entry.items())
    assert coach_entry["source"] == "app" and coach_entry["type"] == "HomeWorkout"
    detail = (await c.get("/api/activity/" + identifier)).json()
    assert detail["source"] == "app" and detail["intervals"] == []
    assert "icu_training_load" not in detail
    analysis = await app.state.tools.call("get_activity_analysis", {"id": identifier})
    assert analysis["activity"]["source"] == "app"
    assert analysis["intervals"] == []
    assert analysis["session"]["above_lt2_seconds"] is None
    assert (await c.post(f"/api/sessions/{identifier}/delete")).status_code == 200
    assert (await c.get("/api/activity/" + identifier)).status_code == 404


def historical_workout(**kwargs):
    return {
        "id": "whoop-synthetic",
        "source": "whoop",
        "type": "Run",
        "start_date": "2026-10-25T01:30:00+00:00",
        "start_date_local": "2026-10-25T02:30:00",
        "elapsed_time": 3600,
        "session_duration": 3600,
        "whoop_strain": 12.5,
        "distance": None,
        **kwargs,
    }


def test_matching_requires_similar_sport_start_and_duration_and_handles_dst():
    w = historical_workout()
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
    w = historical_workout()
    day = date.fromisoformat(w["start_date_local"][:10])
    await store.put("whoop_workouts", w["id"], w, day)
    assert len(await combined_activities(store, day, day)) == 1
    primary = {**w, "id": "garmin", "source": "intervals", "type": "Run"}
    await store.put("activities", primary["id"], primary, day)
    assert [r["id"] for r in await combined_activities(store, day, day)] == ["garmin"]
    assert (await combined_activities(store, day, day, review=True))[0]["duplicate_of"] == "garmin"
    assert await store.get("whoop_workouts", w["id"])
