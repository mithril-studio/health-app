import json

from coach.agent import Agent, cli_environment
from coach.config import Settings


def test_cli_can_use_isolated_refreshable_oauth_login(tmp_path):
    auth_dir = tmp_path / "claude-auth"
    auth_dir.mkdir()
    (auth_dir / ".credentials.json").write_text(
        json.dumps({"claudeAiOauth": {"accessToken": "synthetic-test"}})
    )
    cfg = Settings(
        claude_transport="cli", claude_cli_path="python3", claude_config_dir=str(auth_dir)
    )
    agent = Agent(cfg, None, None, None, None)
    assert agent.status()["configured"] is True
    env = cli_environment(cfg, "/tmp/isolated-request")
    assert env["HOME"] == "/tmp/isolated-request"
    assert env["CLAUDE_CONFIG_DIR"] == str(auth_dir)
    assert "ANTHROPIC_API_KEY" not in env


def test_missing_login_is_not_reported_as_configured(tmp_path):
    cfg = Settings(
        claude_transport="cli", claude_cli_path="python3", claude_config_dir=str(tmp_path)
    )
    assert Agent(cfg, None, None, None, None).status()["configured"] is False
