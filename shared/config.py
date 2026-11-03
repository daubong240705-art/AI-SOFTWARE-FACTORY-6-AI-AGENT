from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ASF_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://asf:asf-local-development@localhost:54329/asf"
    )
    redis_url: SecretStr = SecretStr("redis://localhost:56379/0")


@lru_cache
def get_settings() -> Settings:
    return Settings()
