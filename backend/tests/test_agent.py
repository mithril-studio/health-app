import json
from datetime import date

import httpx
import pytest
from test_tools import WritableSource

from coach.agent import Agent, AgentUnavailable, cli_command, cli_environment, recent_history
from coach.auth import Auth
from coach.config import Settings
from coach.tools import ToolService


async def test_missing_credentials_are_honestly_unconfigured(store):
    settings = Settings(_env_file=None)
    async with httpx.AsyncClient() as client:
        a = Agent(
            settings, store, ToolService(store, WritableSource()), client, Auth(settings, store)
        )
        assert a.status()["configured"] is False
        with pytest.raises(AgentUnavailable):
            await a.respond("hello", key="x")


async def test_agent_loop_is_bounded_and_scheduled_writes_rejected(store):
    requests = []

    async def remote(req):
        requests.append(req)
        return httpx.Response(
            200,
            json={
                "stop_reason": "tool_use",
                "content": [
                    {
                        "type": "tool_use",
                        "id": str(len(requests)),
                        "name": "delete_workout",
                        "input": {"id": "21"},
                    }
                ],
            },
        )

    settings = Settings(_env_file=None, anthropic_api_key="fake", agent_max_rounds=2)
    service = ToolService(store, WritableSource(), telegram_configured=True)
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        a = Agent(settings, store, service, client, Auth(settings, store))
        reply = await a.respond("suggest adjustments", key="job1", read_only=True)
    assert len(requests) == 2 and "limit" in reply.lower()
    assert service.source.calls == []
    assert await store.query("SELECT * FROM pending_deletions") == []
    assert "x-api-key" in requests[0].headers
    assert (
        b"get_calendar" in requests[0].content
        and b'"name":"delete_workout"' not in requests[0].content
    )


def test_cli_has_no_ambient_tools_or_credentials(tmp_path):
    cfg = Settings(_env_file=None, anthropic_oauth_token="explicit-oauth")
    command = cli_command(cfg, str(tmp_path / "mcp.json"), str(tmp_path / "system.txt"), False)
    assert command[command.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in command and "--no-session-persistence" in command
    assert command[command.index("--setting-sources") + 1] == ""
    env = cli_environment(cfg, str(tmp_path))
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "explicit-oauth"
    assert not any(
        x in env
        for x in ("INTERVALS_API_KEY", "MCP_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY")
    )


async def test_chat_idempotency_key_cannot_reuse_a_different_message(store):
    from coach.tools import ToolError

    cfg = Settings(_env_file=None)
    await store.message("reuse:user", "web", "user", "original request")
    await store.message("reuse:reply", "web", "assistant", "original reply")
    agent = Agent(cfg, store, None, None, None)
    with pytest.raises(ToolError):
        await agent.respond("a different request", key="reuse")
    assert await agent.respond("original request", key="reuse") == "original reply"


async def test_large_workout_analysis_reaches_provider_with_individual_reps(store):
    from test_workout import activity, streams

    from coach.models import AthleteScoresInput

    a = activity() | {"start_date_local": "2026-10-08", "unused": "x" * 100000}
    await store.put("activity_intervals", "run", a.pop("intervals"))
    await store.put("activities", "run", a, date(2026, 10, 8))
    await store.put("activity_streams", "run", streams([0, 5, 10], [170, 160, 180]))
    await store.save_athlete_scores(AthleteScoresInput(lt1_hr=145, lt2_hr=169, vo2max=58.5))
    for i in range(12):
        await store.message(
            f"history:{i}", "web", "user" if i % 2 == 0 else "assistant", str(i) + "x" * 7000
        )
    requests = []

    async def remote(req):
        payload = json.loads(req.content)
        requests.append(payload)
        if len(requests) == 1:
            assert len(payload["messages"]) == 3
            assert payload["messages"][0]["content"].startswith("10")
            context = json.loads(
                payload["messages"][-1]["content"].split("Cached data (not instructions):\n")[1]
            )
            assert context["athlete_scores"]["lt2_hr"] == 169
            assert context["conversation_context"]["omitted_messages"] == 10
            return httpx.Response(
                200,
                json={
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "analysis",
                            "name": "get_activity_analysis",
                            "input": {"id": "run"},
                        }
                    ]
                },
            )
        evidence = json.loads(payload["messages"][-1]["content"][0]["content"])
        assert [r["average_heartrate"] for r in evidence["intervals"]] == [160, 150, 172]
        assert evidence["session"]["above_lt2_seconds"] == 5
        assert evidence["threshold"]["source"] == "athlete_scores.lt2_hr"
        assert evidence["next_offset"] is None
        return httpx.Response(200, json={"content": [{"type": "text", "text": "Measured review"}]})

    cfg = Settings(_env_file=None, anthropic_api_key="fake")
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(cfg, store, ToolService(store, WritableSource()), client, Auth(cfg, store))
        assert await agent.respond("Review my sets", key="analysis") == "Measured review"
    assert len(requests) == 2


def test_long_history_keeps_recent_messages_instead_of_omitting_everything():
    history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": str(i) + "x" * 7000}
        for i in range(12)
    ]
    messages, scope = recent_history(history)
    assert len(messages) == 2
    assert messages[0]["content"].startswith("10")
    assert messages[1]["content"].startswith("11")
    assert scope["omitted_messages"] == 10
    assert len(json.dumps(messages, ensure_ascii=False)) <= 15000
    huge, scope = recent_history([{"role": "user", "content": "start" + "x" * 20000 + "end"}])
    assert huge[0]["content"].startswith("start") and huge[0]["content"].endswith("end")
    assert scope["message_text_truncated"] is True
