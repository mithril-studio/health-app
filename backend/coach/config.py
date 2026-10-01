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
    anthropic_api_key: SecretStr = SecretStr("")
    anthropic_oauth_token: SecretStr = SecretStr("")
    anthropic_model: str = "claude-sonnet-4-6"
    claude_transport: str = "auto"
    claude_cli_path: str = "claude"
    claude_config_dir: str = ""
    # Dedicated service-owned directory, containing only the official OAuth login.
    claude_config_dir: str = ""
    claude_cli_timeout: int = Field(default=150, ge=10, le=300)
    agent_max_rounds: int = Field(default=6, ge=1, le=10)
    agent_max_tools: int = Field(default=16, ge=1, le=30)
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

    @field_validator("claude_transport")
    @classmethod
    def valid_transport(cls, value):
        if value not in ("auto", "api", "cli"):
            raise ValueError("CLAUDE_TRANSPORT must be auto, api or cli")
        return value

    @cached_property
    def intervals_configured(self):
        return bool(self.intervals_api_key.get_secret_value() and self.intervals_athlete_id)

    @cached_property
    def telegram_configured(self):
        return bool(self.telegram_bot_token.get_secret_value() and self.telegram_chat_id)
