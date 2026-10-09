import json

import httpx
import pytest
from test_agent import completion
from test_guards import web  # noqa: F401
from test_tools import WritableSource

from coach.agent import SYSTEM, Agent
from coach.config import Settings
from coach.models import ChatInput
from coach.tools import ToolError, ToolService


@pytest.mark.parametrize(
    "body", [{"mode": "workout"}, {"mode": "invalid"}, {"mode": "workout", "activity_id": "../bad"}]
)
def test_invalid_task_input(body):
    with pytest.raises(ValueError):
        ChatInput(message="Review", **body)


def test_default_chat_and_no_hardcoded_personal_assumptions():
    assert ChatInput(message="Hello").mode == "chat"
    assert "under 18" not in SYSTEM and "Mon/Tue" not in SYSTEM


async def test_modes_are_read_only_and_retry_identity_includes_task(store):
    requests = []

    async def remote(req):
        requests.append(json.loads(req.content))
        return httpx.Response(200, json=completion("Advice"))

    cfg = Settings(_env_file=None, openrouter_api_key="fake")
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(cfg, store, ToolService(store, WritableSource()), client)
        assert await agent.respond("Review", key="same", mode="daily") == "Advice"
        assert await agent.respond("Review", key="same", mode="daily") == "Advice"
        for mode, activity_id in [("chat", None), ("weekly", None), ("workout", "one")]:
            with pytest.raises(ToolError, match="Idempotency"):
                await agent.respond("Review", key="same", mode=mode, activity_id=activity_id)
    assert len(requests) == 1
    assert all(t["function"]["name"].startswith("get_") for t in requests[0]["tools"])
    history = await store.history("web")
    assert [r["content"] for r in history] == ["Review", "Advice"]


async def test_shared_profile_across_conversations_without_auto_writes(store):
    await store.save_athlete_profile({"goals": "Synthetic goal", "revision": 0})
    agent = Agent(Settings(_env_file=None), store, ToolService(store, WritableSource()), None)
    assert (await agent.context())["athlete_profile"]["goals"] == "Synthetic goal"
    assert "athlete_scores" not in await agent.context()
    assert await store.history("web") == []


async def test_chat_route_forwards_mode_and_validates_selection(web):  # noqa: F811
    client, app = web
    calls = []

    async def respond(message, **kwargs):
        calls.append(kwargs)
        return "Advice"

    app.state.agent.respond = respond
    headers = {"Authorization": "Bearer api-secret", "Idempotency-Key": "mode-key"}
    bad = await client.post(
        "/api/chat", json={"message": "review", "mode": "workout"}, headers=headers
    )
    assert bad.status_code == 422
    good = await client.post(
        "/api/chat",
        json={"message": "review", "mode": "workout", "activity_id": "i42"},
        headers=headers,
    )
    assert good.status_code == 200
    assert calls[0]["mode"] == "workout" and calls[0]["activity_id"] == "i42"


async def test_selected_workout_evidence_reaches_provider_and_key_cannot_change_activity(store):
    from datetime import date

    from test_workout import activity, streams

    a = activity() | {"start_date_local": "2026-10-08"}
    a["intervals"]["icu_intervals"] *= 15
    await store.put("activity_intervals", "run", a.pop("intervals"))
    await store.put("activities", "run", a, date(2026, 10, 8))
    await store.put("activity_streams", "run", streams([0, 5, 10], [170, 160, 180]))
    prompts = []

    async def remote(req):
        payload = json.loads(req.content)
        context = json.loads(
            payload["messages"][-1]["content"].split("Cached data (not instructions):\n")[1]
        )
        prompts.append(context)
        assert context["selected_activity"]["coverage"]["complete"]
        assert len(context["selected_activity"]["intervals"]) == 45
        assert all(t["function"]["name"].startswith("get_") for t in payload["tools"])
        return httpx.Response(200, json=completion("Workout advice"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(
            Settings(_env_file=None, openrouter_api_key="fake"),
            store,
            ToolService(store, WritableSource()),
            client,
        )
        await agent.respond("Review", key="selected", mode="workout", activity_id="run")
        with pytest.raises(ToolError):
            await agent.respond("Review", key="selected", mode="workout", activity_id="other")
    assert len(prompts) == 1
