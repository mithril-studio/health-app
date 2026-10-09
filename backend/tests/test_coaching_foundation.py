# ruff: noqa: F811
import asyncio
from uuid import uuid4

from test_guards import web  # noqa: F401
from test_workouts import login

PROFILE = dict.fromkeys(
    [
        "goals",
        "background",
        "availability",
        "other_sports",
        "equipment",
        "constraints",
        "preferences",
        "plan_context",
    ],
    "",
) | {"target_date": None, "revision": 0}


async def test_profile_auth_persistence_and_revision(web):
    c, app = web
    path = "/api/athlete-profile"
    assert (await c.get(path)).status_code == 401
    assert (
        await c.post(path, json=PROFILE, headers={"Authorization": "Bearer api-secret"})
    ).status_code == 403
    await login(c)
    assert (await c.get(path)).json() == PROFILE | {"updated_at": None}
    assert (
        await c.post(path, json=PROFILE, headers={"Origin": "https://evil.test"})
    ).status_code == 403
    body = PROFILE | {"goals": "Build consistency", "target_date": "2027-01-01"}
    replies = await asyncio.gather(*(c.post(path, json=body) for _ in range(2)))
    assert sorted(r.status_code for r in replies) == [200, 409]
    saved = (await c.get(path)).json()
    assert saved["revision"] == 1 and saved["updated_at"] and saved["goals"] == body["goals"]
    assert (await app.state.store.athlete_profile())["goals"] == body["goals"]
    for patch in [
        {"goals": "x" * 2001},
        {"revision": True},
        {"target_date": "not-date"},
        {"target_date": "2027-01-01T00:00:00"},
        {"updated_at": None},
        {"goals": 5},
    ]:
        assert (await c.post(path, json=body | {"revision": 1} | patch)).status_code == 422
    assert (await c.post(path, json=PROFILE | {"revision": 1})).json()["revision"] == 2


async def test_records_explicit_transitions_retries_and_shared_reads(web):
    c, app = web
    await login(c)
    path = "/api/coaching-records"
    body = {
        "id": str(uuid4()),
        "kind": "recommendation",
        "text": "Try a lighter week",
        "rationale": "Review recovery",
    }
    replies = await asyncio.gather(*(c.post(path, json=body) for _ in range(3)))
    assert all(r.status_code in (200, 201) for r in replies)
    record = replies[0].json()
    assert record["status"] == "proposed" and record["revision"] == 1 and record["outcome"] == ""
    assert all(r.json() == record for r in replies)
    assert (await c.post(path, json=body | {"text": "Different"})).status_code == 409
    assert (await c.post(path, json=body | {"status": "accepted"})).status_code == 422
    item = path + "/" + body["id"]
    for revision, status, expected in [
        (1, "completed", 409),
        (1, "accepted", 200),
        (1, "dismissed", 409),
        (2, "completed", 200),
        (3, "completed", 200),
        (4, "accepted", 409),
    ]:
        assert (
            await c.patch(
                item, json={"revision": revision, "status": status, "outcome": "Reviewed"}
            )
        ).status_code == expected
    assert (await c.post(path, json=body)).json()["status"] == "completed"
    assert len(await app.state.store.coaching_records()) == 1
    assert (await c.get(path)).json()["records"][0]["status"] == "completed"


async def test_record_write_guards(web):
    c, _ = web
    for method, path, body in [
        (
            "POST",
            "/api/coaching-records",
            {"id": str(uuid4()), "kind": "observation", "text": "Observation", "rationale": ""},
        ),
        (
            "PATCH",
            "/api/coaching-records/" + str(uuid4()),
            {"revision": 1, "status": "accepted", "outcome": ""},
        ),
    ]:
        assert (await c.request(method, path, json=body)).status_code == 401
        assert (
            await c.request(method, path, json=body, headers={"Authorization": "Bearer api-secret"})
        ).status_code == 403
    await login(c)
    del c.headers["Origin"]
    assert (await c.request(method, path, json=body)).status_code == 403


async def test_removed_routes(web):
    c, _ = web
    await login(c)
    for method, path in [
        ("GET", "/api/athlete-scores"),
        ("POST", "/api/athlete-scores"),
        ("GET", "/api/whoop"),
        ("GET", "/api/whoop/workouts"),
        *[
            ("POST", "/api/whoop/" + name)
            for name in ["authorize", "connect", "sync", "disconnect"]
        ],
    ]:
        assert (await c.request(method, path, json={})).status_code == 404


async def test_retired_data_survives_migrations_and_history_reads(web):
    from datetime import date

    from test_workouts import historical_workout

    from coach.models import AthleteScoresInput

    c, app = web
    store = app.state.store
    await store.save_athlete_scores(AthleteScoresInput(lt1_hr=None, lt2_hr=None, vo2max=None))
    await store.execute(
        "INSERT INTO whoop_connection VALUES (1,'synthetic-access','synthetic-refresh',now(),NULL,NULL)"
    )
    workout = historical_workout()
    await store.put("whoop_workouts", workout["id"], workout, date(2026, 10, 25))
    # Recreate the pre-009 schema in this fixture's isolated disposable namespace.
    await store.execute("DROP TABLE athlete_profile,coaching_records")
    await store.execute("DELETE FROM schema_migrations WHERE version='009_coaching.sql'")
    await store.migrate()
    assert await store.query("SELECT 1 FROM athlete_scores")
    assert await store.query("SELECT 1 FROM whoop_connection")
    await login(c)
    dashboard = (await c.get("/api/dashboard?oldest=2026-10-25&newest=2026-10-25")).json()
    assert dashboard["activities"][0]["source"] == "whoop"
    detail = (await c.get("/api/activity/" + workout["id"])).json()
    assert detail["whoop_strain"] == 12.5
    assert "icu_training_load" not in detail and "moving_time" not in detail


async def test_record_validation_dismissal_missing_and_concurrent_updates(web):
    c, _ = web
    await login(c)
    path = "/api/coaching-records"
    body = {"id": str(uuid4()), "kind": "question", "text": "How did it feel?", "rationale": ""}
    for patch in [
        {"id": "bad"},
        {"kind": "plan"},
        {"text": ""},
        {"text": "x" * 4001},
        {"rationale": "x" * 2001},
        {"text": 5},
    ]:
        assert (await c.post(path, json=body | patch)).status_code == 422
    assert (await c.get(path)).json()["records"] == []
    assert (
        await c.patch(
            path + "/" + body["id"], json={"revision": 1, "status": "accepted", "outcome": ""}
        )
    ).status_code == 404
    await c.post(path, json=body)
    item = path + "/" + body["id"]
    for patch in [
        {"revision": True},
        {"revision": 0},
        {"status": "proposed"},
        {"outcome": "x" * 2001},
        {"extra": 1},
    ]:
        assert (
            await c.patch(item, json={"revision": 1, "status": "accepted", "outcome": ""} | patch)
        ).status_code == 422
    results = await asyncio.gather(
        *(
            c.patch(item, json={"revision": 1, "status": status, "outcome": ""})
            for status in ["accepted", "dismissed"]
        )
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    current = (await c.get(path)).json()["records"][0]
    if current["status"] == "accepted":
        assert (
            await c.patch(item, json={"revision": 2, "status": "dismissed", "outcome": ""})
        ).status_code == 200
    current = (await c.get(path)).json()["records"][0]
    assert (
        await c.patch(
            item, json={"revision": current["revision"], "status": "accepted", "outcome": ""}
        )
    ).status_code == 409


async def test_record_listing_is_bounded_newest_first_and_cross_conversation(web):
    c, app = web
    await login(c)
    for index in range(55):
        await app.state.store.create_coaching_record(
            {
                "id": str(uuid4()),
                "kind": "observation",
                "text": f"Observation {index}",
                "rationale": "",
            }
        )
    await c.post("/api/conversations", json={})
    records = (await c.get("/api/coaching-records")).json()["records"]
    assert len(records) == 50
    assert records[0]["text"] == "Observation 54" and records[-1]["text"] == "Observation 5"
    assert all(record["status"] == "proposed" for record in records)
