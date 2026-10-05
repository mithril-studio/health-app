import json
import logging
import os

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


async def test_chat_idempotency_key_cannot_reuse_a_different_message(store):
    from coach.tools import ToolError

    cfg = Settings(_env_file=None)
    await store.message("reuse:user", "web", "user", "original request")
    await store.message("reuse:reply", "web", "assistant", "original reply")
    agent = Agent(cfg, store, None, None, None)
    with pytest.raises(ToolError):
        await agent.respond("a different request", key="reuse")
    assert await agent.respond("original request", key="reuse") == "original reply"


def fake_cli(tmp_path, result):
    script = tmp_path / "claude"
    script.write_text(
        "#!/bin/sh\ncat >/dev/null\nprintf '%s' " + json.dumps(json.dumps(result)) + "\n"
    )
    script.chmod(0o700)
    return str(script)


def saved_login(tmp_path, token="synthetic-test"):
    auth_dir = tmp_path / "claude-auth"
    auth_dir.mkdir(exist_ok=True)
    (auth_dir / ".credentials.json").write_text(
        json.dumps({"claudeAiOauth": {"accessToken": token}})
    )
    return auth_dir


async def test_expired_cli_login_is_reported_logged_and_recovers_after_relogin(
    store, tmp_path, caplog
):
    auth_dir = saved_login(tmp_path)
    cfg = Settings(
        _env_file=None,
        claude_transport="cli",
        claude_config_dir=str(auth_dir),
        claude_cli_path=fake_cli(
            tmp_path,
            {
                "is_error": True,
                "result": "Failed to authenticate: OAuth session expired and could not be refreshed",
            },
        ),
    )
    async with httpx.AsyncClient() as client:
        a = Agent(cfg, store, ToolService(store, WritableSource()), client, Auth(cfg, store))
        assert a.status()["configured"] is True
        with (
            caplog.at_level(logging.WARNING, logger="coach"),
            pytest.raises(AgentUnavailable, match="sign in again"),
        ):
            await a.respond("hello", key="expired-1")
    assert "claude_cli_failed" in caplog.text and "OAuth session expired" in caplog.text
    assert "hello" not in caplog.text
    status = a.status()
    assert status["configured"] is False and "sign in again" in status["reason"]
    # Subsequent requests fail fast with the same actionable reason, without a CLI call.
    with pytest.raises(AgentUnavailable, match="sign in again"):
        await a.respond("hello again", key="expired-2")
    # A re-login rewrites the credential file; the service notices without a restart.
    credential = auth_dir / ".credentials.json"
    credential.write_text(json.dumps({"claudeAiOauth": {"accessToken": "renewed-test"}}))
    os.utime(credential, ns=(credential.stat().st_atime_ns, credential.stat().st_mtime_ns + 1))
    assert a.status() == {"configured": True, "transport": "cli", "reason": None}


def test_wiped_credential_file_reports_expired_login(tmp_path):
    auth_dir = saved_login(tmp_path, token="")
    cfg = Settings(
        _env_file=None,
        claude_transport="cli",
        claude_cli_path="python3",
        claude_config_dir=str(auth_dir),
    )
    status = Agent(cfg, None, None, None, None).status()
    assert status["configured"] is False and "expired or was revoked" in status["reason"]
    # An explicit long-lived token overrides a wiped saved login.
    cfg = Settings(
        _env_file=None,
        claude_transport="cli",
        claude_cli_path="python3",
        claude_config_dir=str(auth_dir),
        anthropic_oauth_token="explicit-oauth",
    )
    assert Agent(cfg, None, None, None, None).status()["configured"] is True


async def test_other_cli_failures_do_not_mark_login_rejected(store, tmp_path):
    cfg = Settings(
        _env_file=None,
        claude_transport="cli",
        claude_config_dir=str(saved_login(tmp_path)),
        claude_cli_path=fake_cli(tmp_path, {"is_error": True, "result": "Rate limit reached"}),
    )
    async with httpx.AsyncClient() as client:
        a = Agent(cfg, store, ToolService(store, WritableSource()), client, Auth(cfg, store))
        with pytest.raises(AgentUnavailable, match="could not complete"):
            await a.respond("hello", key="transient-1")
    assert a.status()["configured"] is True
