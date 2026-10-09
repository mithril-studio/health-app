"""Cross-layer acceptance checks using real cache projections and synthetic evidence."""

from datetime import date
from uuid import uuid4

import pytest

from coach.briefs import build_brief
from coach.tools import ToolService


async def test_daily_brief_preserves_plan_instructions_and_athlete_feedback(store):
    today = date(2026, 10, 9)
    await store.put(
        "events",
        "plan",
        {
            "id": "plan",
            "start_date_local": str(today),
            "type": "Run",
            "description": "Easy conversational effort; shorten if tired",
        },
        today,
    )
    await store.put(
        "local_sessions",
        "local-feedback",
        {
            "id": "local-feedback",
            "start_date_local": str(today),
            "type": "Yoga",
            "source": "app",
            "description": "Felt stiff after yesterday",
        },
        today,
    )
    brief = await build_brief(store, ToolService(store, None), mode="daily", today=today)
    assert brief["today_plan"][0]["description"] == "Easy conversational effort; shorten if tired"
    assert brief["recent_activities"][0]["description"] == "Felt stiff after yesterday"


async def test_real_workout_brief_compares_structured_targets_preserving_zero(store):
    today = date(2026, 10, 9)
    await store.put(
        "activities",
        "run",
        {
            "id": "run",
            "start_date_local": str(today),
            "type": "Run",
            "moving_time": 0,
            "distance": 0,
            "icu_training_load": 0,
        },
        today,
    )
    await store.put("activity_intervals", "run", [])
    await store.put("activity_streams", "run", [])
    await store.put(
        "events",
        "plan",
        {
            "id": "plan",
            "start_date_local": str(today),
            "type": "Run",
            "paired_activity_id": "run",
            "moving_time": 600,
            "distance": 1000,
            "icu_training_load": 10,
        },
        today,
    )
    brief = await build_brief(
        store, ToolService(store, None), mode="workout", activity_id="run", today=today
    )
    comparison = brief["selected_activity"]["target_vs_actual"][0]
    assert comparison["distance"] == {"actual": 0, "target": 1000, "difference": -1000}
    assert comparison["moving_time"]["actual"] == 0
    assert comparison["icu_training_load"]["actual"] == 0


async def test_outstanding_records_survive_recent_noise_and_disclose_store_cap(store):
    for kind in ("recommendation", "observation"):
        record = await store.create_coaching_record(
            {"id": str(uuid4()), "kind": kind, "text": f"Older {kind}", "rationale": ""}
        )
        await store.update_coaching_record(
            record["id"], {"revision": 1, "status": "accepted", "outcome": ""}
        )
    for i in range(55):
        await store.create_coaching_record(
            {"id": str(uuid4()), "kind": "question", "text": f"New question {i}", "rationale": ""}
        )
    brief = await build_brief(store, ToolService(store, None), mode="weekly")
    assert {r["kind"] for r in brief["coaching_records"]["accepted"]} == {
        "recommendation",
        "observation",
    }
    coverage = brief["coaching_record_coverage"]
    assert coverage["total"] == 57 and coverage["included"] == 50
    assert coverage["omitted"] == 7 and coverage["accepted_included"] == 2
    assert coverage["accepted_total"] == 2


async def test_zone_write_tool_is_retired_before_any_upstream_or_telegram_access(store):
    with pytest.raises(ValueError, match="unknown tool"):
        await ToolService(store, None).call("update_zones", {"sport": "Run", "ftp": 250})


async def test_queued_zone_write_retires_without_telegram_or_upstream(store):
    from coach.config import Settings
    from coach.jobs import Jobs

    tools = ToolService(store, None)
    await tools.prepare_write("old-zones", "update_zones", {}, "PUT", "sport-settings/1", {})
    jobs = Jobs(Settings(_env_file=None), store, tools, None, None)
    result = await jobs.process("write:old-zones")
    assert result["status"] == "succeeded"
    assert result["result"]["status"] == "retired"
    assert [r["action"] for r in await store.query("SELECT * FROM write_audit")] == ["requested"]


async def test_concurrent_task_key_cannot_cross_conversations_or_leak_metadata(store):
    import asyncio
    import json

    import httpx
    from test_agent import completion
    from test_tools import WritableSource

    from coach.agent import Agent
    from coach.config import Settings
    from coach.tools import ToolError

    requests = []

    async def remote(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=completion("Synthetic advice"))

    other = "web:" + uuid4().hex
    await store.create_conversation(other)
    await store.save_athlete_profile({"revision": 0, "goals": "Synthetic shared goal"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(
            Settings(_env_file=None, openrouter_api_key="fake"),
            store,
            ToolService(store, WritableSource()),
            client,
        )
        results = await asyncio.gather(
            *(
                agent.respond("Review", key="racing-key", channel=channel, mode="weekly")
                for channel in ("web", other)
            ),
            return_exceptions=True,
        )
        assert sum(isinstance(r, ToolError) and r.status == 409 for r in results) == 1
        assert len(requests) == 1
        await agent.respond("Second conversation", key="other-key", channel=other)
    for request in requests:
        assert "Synthetic shared goal" in request["messages"][-1]["content"]
    for channel in ("web", other):
        assert all(r["role"] in ("user", "assistant") for r in await store.history(channel))
    assert await store.coaching_records() == []
