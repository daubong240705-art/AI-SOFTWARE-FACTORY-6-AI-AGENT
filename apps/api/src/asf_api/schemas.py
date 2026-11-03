import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class ProjectCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str = Field(default="", max_length=4000)
    repository_url: str | None = Field(default=None, max_length=500)

    @field_validator("repository_url")
    @classmethod
    def validate_repository_url(cls, value: str | None) -> str | None:
        if not value:
            return None
        url = HttpUrl(value)
        if url.username or url.password or url.query or url.fragment:
            raise ValueError("Repository URL must not contain credentials, query or fragment")
        return str(url)


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    description: str
    repository_url: str | None
    created_at: datetime
    updated_at: datetime


class ProjectList(BaseModel):
    items: list[ProjectRead]
    total: int
    limit: int
    offset: int
