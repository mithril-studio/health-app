from functools import cached_property
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)
    database_url: SecretStr = SecretStr("postgresql://localhost/coach_reachy")
    app_password: SecretStr = SecretStr("")
    app_origin: str = "https://localhost:8000"
    api_auth_token: SecretStr = SecretStr("")
    mcp_auth_token: SecretStr = SecretStr("")
    box_shared_secret: SecretStr = SecretStr("")
    intervals_api_key: SecretStr = SecretStr("")
    intervals_athlete_id: str = ""
    telegram_bot_token: SecretStr = SecretStr("")
    telegram_chat_id: str = ""
    openrouter_api_key: SecretStr = SecretStr("")
    openrouter_model: str = Field(default="moonshotai/kimi-k3", min_length=1)
    agent_timeout_seconds: int = Field(default=150, ge=10, le=150)
    agent_max_tokens: int = Field(default=8192, ge=256, le=32768)
    agent_max_rounds: int = Field(default=6, ge=1, le=10)
    agent_max_tools: int = Field(default=16, ge=1, le=30)
    # Characters of one tool result handed to the model; larger results ask for a narrower
    # range or the summary tool instead of being silently truncated.
    agent_result_chars: int = Field(default=80000, ge=5000, le=400000)
    sync_interval_seconds: int = Field(default=300, ge=30)
    background_enabled: bool = True

    @field_validator("app_origin")
    @classmethod
    def valid_origin(cls, value):
        parsed = urlsplit(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.username
        ):
            raise ValueError("APP_ORIGIN must be a single origin")
        return value.rstrip("/")

    @cached_property
    def intervals_configured(self):
        return bool(self.intervals_api_key.get_secret_value() and self.intervals_athlete_id)

    @cached_property
    def telegram_configured(self):
        return bool(self.telegram_bot_token.get_secret_value() and self.telegram_chat_id)
