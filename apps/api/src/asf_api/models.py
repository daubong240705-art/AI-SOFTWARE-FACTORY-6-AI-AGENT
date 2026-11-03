import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("slug", name="uq_projects_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    repository_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_project_id", "project_id"),
        CheckConstraint(
            "status IN ('created','planning','waiting_approval','running','blocked',"
            "'completed','failed','cancelled')",
            name="ck_runs_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    requirement: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="created", server_default="created")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_run_id", "run_id"),
        CheckConstraint("role IN ('pm','ba','be','fe','test','devops')", name="ck_tasks_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(240))
    role: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(32), default="backlog", server_default="backlog")
    simulated: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_run_id_id", "run_id", "id"),
        UniqueConstraint("idempotency_key", name="uq_events_idempotency_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    idempotency_key: Mapped[str | None] = mapped_column(String(160))
    simulated: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
