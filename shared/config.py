from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ASF_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "staging", "production"] = "development"
    release_sha: str = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://asf:asf-local-development@localhost:54329/asf"
    )
    redis_url: SecretStr = SecretStr("redis://localhost:56379/0")
    queue_name: str = "asf"
    live_mode_enabled: bool = False
    router_url: str = "https://ai.lazy.local/v1"
    router_api_key: SecretStr = SecretStr("")
    router_ca_file: str | None = None
    router_model: str = "coding-main"
    model_catalog: list[str] = ["coding-main"]
    gitlab_url: str = "https://gitlab.lazy.local"
    gitlab_api_token: SecretStr = SecretStr("")
    gitlab_ca_file: str | None = None
    openproject_url: str = "https://openproject.lazy247.space"
    openproject_api_token: SecretStr = SecretStr("")
    integration_profiles_file: str | None = None
    worker_lease_seconds: int = Field(default=60, ge=20, le=300)
    worker_task_timeout_seconds: int = Field(default=900, ge=30, le=1800)
    worker_recovery_limit: int = Field(default=2, ge=0, le=5)
    gitlab_webhook_secret: SecretStr = SecretStr("")
    model_timeout_seconds: int = Field(default=60, ge=1, le=120)
    model_http_attempts: int = Field(default=2, ge=1, le=3)
    model_max_output_tokens: int = Field(default=2000, ge=256, le=8000)
    run_token_budget: int = Field(default=100000, ge=10000, le=1000000)
    run_call_limit: int = Field(default=6, ge=2, le=12)
    run_retry_limit: int = Field(default=2, ge=0, le=5)
    dispatch_lease_seconds: int = Field(default=45, ge=15, le=300)
    dispatch_recovery_limit: int = Field(default=2, ge=0, le=5)
    session_hours: int = Field(default=8, ge=1, le=168)
    session_cookie_secure: bool = False
    allowed_origins: list[str] = [
        "http://localhost:13000",
        "http://127.0.0.1:13000",
        "http://localhost:18000",
        "http://127.0.0.1:18000",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
