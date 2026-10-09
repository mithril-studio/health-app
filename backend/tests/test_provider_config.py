import pytest
from pydantic import ValidationError

from coach.agent import Agent
from coach.config import Settings


def test_legacy_oauth_does_not_configure_the_deployed_provider():
    cfg = Settings(_env_file=None, anthropic_oauth_token="legacy", claude_transport="cli")
    assert Agent(cfg, None, None, None).status()["configured"] is False
    cfg = Settings(_env_file=None, openrouter_api_key="configured", openrouter_model="custom/model")
    status = Agent(cfg, None, None, None).status()
    assert status["configured"] is True and status["model"] == "custom/model"


def test_provider_limits_are_bounded():
    for settings in [
        {"agent_timeout_seconds": 999},
        {"agent_max_rounds": 99},
        {"agent_max_tokens": 0},
    ]:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **settings)
