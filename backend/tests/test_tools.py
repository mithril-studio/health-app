import asyncio
from datetime import date

import pytest
from test_persistence import Source

from coach.tools import ToolError, ToolService


class WritableSource(Source):
    configured = True

    def __init__(self):
        super().__init__()
        self.event_data = {
            "id": 21,
            "category": "WORKOUT",
            "name": "Easy",
            "start_date_local": "2026-10-01T10:00:00",
        }
        self.calls = []

    async def event(self, id):
        return dict(self.event_data)

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if method == "DELETE":
            return {}
        self.event_data.update(kwargs.get("json", {}))
        return dict(self.event_data)


@pytest.fixture
async def tool_service(store):
    source = WritableSource()
    return ToolService(store, source, telegram_configured=True)


async def test_delete_request_never_deletes_and_confirmation_only_once(tool_service, store):
    result = await tool_service.call("delete_workout", {"id": "21"}, operation_key="user1")
    assert result["pending_confirmation"] is True and "token" not in result
    assert tool_service.source.calls == []
    pending = await tool_service.pending_deletions()
    token = pending[0]["token"]
    results = await asyncio.gather(*(tool_service.confirm_delete(token) for _ in range(5)))
    assert all(r["status"] == "done" for r in results)
    assert [r[0] for r in tool_service.source.calls] == ["DELETE"]
    assert len(await store.query("SELECT * FROM write_audit")) == 2
    assert len(await store.query("SELECT * FROM work_items WHERE kind='notification'")) == 1


async def test_delete_expiry_and_changed_event_require_new_confirmation(tool_service, store):
    await tool_service.call("delete_workout", {"id": "21"})
    token = (await tool_service.pending_deletions())[0]["token"]
    tool_service.source.event_data["name"] = "Changed remotely"
    with pytest.raises(ToolError):
        await tool_service.confirm_delete(token)
    assert tool_service.source.calls == []
    await store.execute("UPDATE pending_deletions SET expires_at=now()-interval '1 minute'")
    with pytest.raises(ToolError):
        await tool_service.confirm_delete(token)


async def test_model_cannot_confirm_or_write_scheduled_advice(tool_service):
    for name, args in [
        ("confirm_delete", {"token": "x"}),
        ("delete_workout", {"id": "21", "confirmed": True}),
    ]:
        with pytest.raises(ValueError):
            await tool_service.call(name, args)
    with pytest.raises(ToolError):
        await tool_service.call(
            "plan_workout",
            {"date": "2026-10-01", "name": "X", "sport": "Run", "description": "- 10m Z2"},
            read_only=True,
        )
    assert tool_service.source.calls == []


async def test_write_replay_is_idempotent_and_refreshes_cache(tool_service, store):
    args = {"id": "21", "date": "2026-10-03"}
    result = await tool_service.call("move_workout", args, operation_key="tg:7:move")
    again = await tool_service.call("move_workout", args, operation_key="tg:7:move")
    assert result == again and len(tool_service.source.calls) == 1
    assert tool_service.source.calls[0][2]["json"] == {"start_date_local": "2026-10-03T10:00:00"}
    assert (await store.get("events", "21"))["start_date_local"] == "2026-10-03T10:00:00"
    with pytest.raises(ToolError):
        await tool_service.call(
            "move_workout", {"id": "21", "date": "2026-10-04"}, operation_key="tg:7:move"
        )


async def test_read_tools_use_cache_without_remote_requests(tool_service, store):
    await store.put(
        "activities",
        "a",
        {"id": "a", "type": "Run", "start_date_local": "2026-10-01"},
        date(2026, 10, 1),
    )
    await store.put("activity_intervals", "a", {"icu_intervals": []})
    assert (await tool_service.call("get_activity", {"id": "a"}))["id"] == "a"
    assert tool_service.source.calls == []


async def test_analysis_uses_cached_intervals_streams_and_sport_threshold(tool_service, store):
    from test_workout import activity, streams

    a = activity()
    detail = a.pop("intervals")
    a.pop("lthr")
    await store.put("activities", "run", a, date(2026, 10, 8))
    await store.put("activity_intervals", "run", detail)
    await store.put("activity_streams", "run", streams([0, 5, 10], [165, 170, 180]))
    await store.put("sport_settings", "run", {"id": "run", "types": ["Run"], "lthr": 165})
    planned = {"id": "21", "description": "5 x 800m at 3:50–3:55/km", "paired_activity_id": "run"}
    await store.put("events", "21", planned, date(2026, 10, 7))
    await store.put(
        "events", "22", {"id": "22", "description": "Unpaired workout"}, date(2026, 10, 8)
    )
    result = await tool_service.call("get_activity_analysis", {"id": "run"}, read_only=True)
    assert result["session"]["above_lt2_seconds"] == 5
    assert result["threshold"]["source"] == "current_sport_settings.lthr"
    assert len(result["intervals"]) == 3
    assert result["paired_workouts"] == [planned]
    page = await tool_service.call("get_activity_analysis", {"id": "run", "offset": 1, "limit": 1})
    assert page["intervals"][0]["set"] == 2 and page["next_offset"] == 2
    # Existing activity endpoint retains the raw contract.
    assert (await tool_service.activity("run"))["intervals"] == detail
    assert tool_service.source.calls == []


async def test_long_paired_plan_cannot_evict_individual_intervals(tool_service, store):
    import json

    from test_workout import activity

    a = activity()
    detail = a.pop("intervals")
    detail["icu_intervals"] *= 20
    await store.put("activities", "run", a, date(2026, 10, 8))
    await store.put("activity_intervals", "run", detail)
    await store.put("activity_streams", "run", [])
    await store.put(
        "events",
        "21",
        {"id": "21", "description": "x" * 10000, "paired_activity_id": "run"},
        date(2026, 10, 8),
    )
    offset, seen = 0, []
    while offset is not None:
        result = await tool_service.call("get_activity_analysis", {"id": "run", "offset": offset})
        assert len(json.dumps(result)) < 20000
        assert len(result["paired_workouts"][0]["description"]) == 10000
        seen.extend(row["set"] for row in result["intervals"])
        offset = result["next_offset"]
    assert seen == list(range(1, 61))


async def test_refresh_failure_does_not_repeat_remote_mutation(tool_service, store):
    original = tool_service.source.event
    reads = 0

    async def event(id):
        nonlocal reads
        reads += 1
        if reads == 2:
            raise RuntimeError("refresh unavailable")
        return await original(id)

    tool_service.source.event = event
    with pytest.raises(RuntimeError):
        await tool_service.call("update_workout", {"id": "21", "name": "New"}, operation_key="once")
    assert (await store.query("SELECT status FROM write_operations WHERE id='once'", one=True))[
        "status"
    ] == "applied"
    await tool_service.execute_write("once")
    assert len(tool_service.source.calls) == 1
    assert (await store.get("events", "21"))["name"] == "New"


async def test_sync_cannot_overwrite_a_racing_write(tool_service, store):
    entered, finish = asyncio.Event(), asyncio.Event()
    original = tool_service.source.events_range

    async def events(oldest, newest):
        data = await original(oldest, newest)
        entered.set()
        await finish.wait()
        return data

    tool_service.source.events_range = events
    sync = asyncio.create_task(tool_service.sync.run(today=date(2026, 10, 1)))
    await entered.wait()
    write = asyncio.create_task(
        tool_service.call("update_workout", {"id": "21", "name": "Fresh"}, operation_key="racing")
    )
    await asyncio.sleep(0.03)
    finish.set()
    await asyncio.gather(sync, write)
    assert (await store.get("events", "21"))["name"] == "Fresh"


async def test_pending_confirmation_key_cannot_change_target(tool_service):
    await tool_service.call("delete_workout", {"id": "21"}, operation_key="fixed")
    with pytest.raises(ToolError):
        await tool_service.call("delete_workout", {"id": "22"}, operation_key="fixed")


async def test_old_queued_zone_write_is_retired_without_upstream_call(tool_service, store):
    await tool_service.prepare_write(
        "old-zone",
        "update_zones",
        {"sport": "Run", "ftp": 250},
        "PUT",
        "sport-settings/1",
        {"ftp": 250},
    )
    result = await tool_service.execute_write("old-zone")
    assert result["status"] == "retired"
    assert tool_service.source.calls == []
    assert (await store.query("SELECT status FROM write_operations WHERE id='old-zone'", one=True))[
        "status"
    ] == "done"
