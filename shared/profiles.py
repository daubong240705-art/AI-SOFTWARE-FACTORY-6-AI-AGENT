"""Administrator-owned integration targets; API inputs never select hosts or secrets."""

import json
import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shared.config import get_settings

ROLES = ("pm", "ba", "be", "fe", "test", "devops")


class IntegrationProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = Field(min_length=1, max_length=120)
    gitlab_project_id: int = Field(gt=0)
    repository_url: str
    default_branch: str = "main"
    openproject_project_id: int = Field(gt=0)
    work_package_type_id: int = 1
    bug_type_id: int = 7
    test_profile: Literal["python-unittest", "node-test"] = "python-unittest"
    allowed_paths: list[str] = ["src/", "tests/"]
    required_ci_jobs: list[str] = Field(default=["test"], min_length=1, max_length=20)
    deploy_job: str = "deploy_staging"
    package_job: str = "package_candidate"
    deployment_url: str | None = None
    enabled: bool = True

    @field_validator("deployment_url")
    @classmethod
    def deployment(cls, value: str | None) -> str | None:
        if value is not None:
            url = urlsplit(value)
            origin = f"{url.scheme}://{url.netloc}"
            if (
                origin not in get_settings().deployment_health_origins
                or url.username
                or url.query
                or url.fragment
                or not url.path.endswith("/healthz")
            ):
                raise ValueError("deployment_health_url_not_allowed")
        return value

    @field_validator("repository_url")
    @classmethod
    def repository(cls, value: str) -> str:
        url = urlsplit(value)
        trusted = urlsplit(get_settings().gitlab_url)
        if (
            url.scheme != "https"
            or url.netloc != trusted.netloc
            or url.username
            or url.query
            or url.fragment
            or not url.path.endswith(".git")
        ):
            raise ValueError("repository_not_allowed")
        return value

    @field_validator("default_branch")
    @classmethod
    def branch(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_/-]{0,79}", value):
            raise ValueError("invalid_branch")
        return value

    @field_validator("allowed_paths")
    @classmethod
    def paths(cls, values: list[str]) -> list[str]:
        if not values or len(values) > 20:
            raise ValueError("invalid_paths")
        for value in values:
            if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*/", value):
                raise ValueError("invalid_path")
            if value.split("/")[0] in {".git", ".github", "infrastructure"}:
                raise ValueError("invalid_path")
        return values


def profiles() -> dict[str, IntegrationProfile]:
    path = get_settings().integration_profiles_file
    if not path:
        return {}
    with open(path, encoding="utf-8") as source:
        raw = json.load(source)
    if not isinstance(raw, dict) or len(raw) > 50:
        raise ValueError("invalid_profiles")
    if any(not re.fullmatch(r"[a-z0-9-]{1,80}", key) for key in raw):
        raise ValueError("invalid_profile_id")
    return {key: IntegrationProfile.model_validate(value) for key, value in raw.items()}


def model_selection(overrides: dict[str, str] | None = None) -> dict[str, str]:
    settings = get_settings()
    result = dict.fromkeys(ROLES, settings.router_model)
    result.update(overrides or {})
    for role, model in result.items():
        if role not in ROLES or model not in settings.model_catalog:
            raise ValueError("model_not_allowed")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}", model):
            raise ValueError("model_not_allowed")
    return result


def allowed_file(path: str, profile: IntegrationProfile) -> bool:
    return bool(
        len(path) <= 240
        and re.fullmatch(r"[A-Za-z0-9_./-]+", path)
        and all(part not in {"", ".", "..", ".git"} for part in path.split("/"))
        and path.startswith(tuple(profile.allowed_paths))
    )
