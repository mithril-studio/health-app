import httpx
import pytest
from test_tools import WritableSource

from coach.agent import Agent, AgentUnavailable, cli_command, cli_environment
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
