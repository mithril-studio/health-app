import json

import httpx
import pytest
from test_tools import WritableSource

from coach.agent import Agent, AgentUnavailable
from coach.config import Settings
from coach.tools import ToolError, ToolService


def completion(content="A grounded reply", calls=None, **extra):
    message = {"role": "assistant", "content": content, **extra}
    if calls:
        message["tool_calls"] = calls
    return {"choices": [{"finish_reason": "tool_calls" if calls else "stop", "message": message}]}


def tool_call(name, arguments, identifier="call-1"):
    return {
        "id": identifier,
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(arguments),
        },
    }


async def test_missing_credentials_are_honestly_unconfigured(store):
    settings = Settings(_env_file=None)
    agent = Agent(settings, store, ToolService(store, WritableSource()), None)
    assert agent.status()["configured"] is False
    assert agent.status()["transport"] == "openrouter"
    with pytest.raises(AgentUnavailable, match="API key") as error:
        await agent.respond("hello", key="x")
    assert error.value.code == "openrouter_not_configured"


async def test_agent_loop_is_bounded_and_scheduled_writes_rejected(store):
    requests = []

    async def remote(req):
        requests.append(req)
        return httpx.Response(
            200, json=completion(None, [tool_call("delete_workout", {"id": "21"})])
        )

    settings = Settings(_env_file=None, openrouter_api_key="fake", agent_max_rounds=2)
    service = ToolService(store, WritableSource(), telegram_configured=True)
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(settings, store, service, client)
        reply = await agent.respond("suggest adjustments", key="job1", read_only=True)
    assert len(requests) == 2 and "limit" in reply.lower()
    assert service.source.calls == []
    assert await store.query("SELECT * FROM pending_deletions") == []
    assert requests[0].headers["Authorization"] == "Bearer fake"
    assert str(requests[0].url) == "https://openrouter.ai/api/v1/chat/completions"
    names = {t["function"]["name"] for t in json.loads(requests[0].content)["tools"]}
    assert "get_calendar" in names and "delete_workout" not in names


async def test_chat_idempotency_key_cannot_reuse_a_different_message(store):
    cfg = Settings(_env_file=None)
    await store.message("reuse:user", "web", "user", "original request")
    await store.message("reuse:reply", "web", "assistant", "original reply")
    agent = Agent(cfg, store, None, None)
    with pytest.raises(ToolError):
        await agent.respond("a different request", key="reuse")
    assert await agent.respond("original request", key="reuse") == "original reply"


async def test_tool_round_preserves_reasoning_and_caches_completed_reply(store):
    requests = []
    reasoning = [{"type": "reasoning.encrypted", "data": "opaque-state"}]

    async def remote(req):
        requests.append(json.loads(req.content))
        body = (
            completion()
            if len(requests) > 1
            else completion(
                None,
                [tool_call("get_calendar", {"oldest": "2026-10-01", "newest": "2026-10-09"})],
                reasoning_details=reasoning,
            )
        )
        return httpx.Response(200, json=body)

    cfg = Settings(_env_file=None, openrouter_api_key="fake")
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        agent = Agent(cfg, store, ToolService(store, WritableSource()), client)
        assert await agent.respond("review", key="review") == "A grounded reply"
        assert await agent.respond("review", key="review") == "A grounded reply"
    assert len(requests) == 2
    messages = requests[1]["messages"]
    assert messages[-2]["reasoning_details"] == reasoning
    assert messages[-1]["role"] == "tool" and messages[-1]["tool_call_id"] == "call-1"
    assert "activities" in json.loads(messages[-1]["content"])


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "openrouter_auth"),
        (402, "openrouter_credits"),
        (429, "openrouter_rate_limit"),
        (400, "openrouter_model"),
        (503, "openrouter_unavailable"),
        (504, "openrouter_timeout"),
    ],
)
async def test_provider_errors_are_safe_and_actionable(status, code):
    cfg = Settings(_env_file=None, openrouter_api_key="fake")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(status, text="private provider payload")
        )
    ) as client:
        agent = Agent(cfg, None, None, client)
        with pytest.raises(AgentUnavailable) as error:
            await agent.api("private prompt", [], "error", True)
    assert error.value.code == code
    assert "private" not in str(error.value)
    assert agent.status()["configured"] is (status != 401)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"choices": []},
        {"choices": [{"finish_reason": "length", "message": {}}]},
        completion(""),
        completion(None, [tool_call("get_calendar", {}), tool_call("get_calendar", {})]),
    ],
)
async def test_incomplete_or_malformed_responses_are_rejected(body):
    cfg = Settings(_env_file=None, openrouter_api_key="fake")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    ) as client:
        with pytest.raises(AgentUnavailable) as error:
            await Agent(cfg, None, None, client).api("prompt", [], "bad", True)
    assert error.value.code == "openrouter_invalid_response"


async def test_embedded_provider_error_and_transport_timeout():
    cfg = Settings(_env_file=None, openrouter_api_key="fake")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"error": {"code": 402, "message": "private"}})
        )
    ) as client:
        with pytest.raises(AgentUnavailable) as error:
            await Agent(cfg, None, None, client).api("prompt", [], "embedded", True)
        assert error.value.code == "openrouter_credits"

    def timeout(request):
        raise httpx.ReadTimeout("private", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
        with pytest.raises(AgentUnavailable) as error:
            await Agent(cfg, None, None, client).api("prompt", [], "timeout", True)
        assert error.value.code == "openrouter_timeout"
