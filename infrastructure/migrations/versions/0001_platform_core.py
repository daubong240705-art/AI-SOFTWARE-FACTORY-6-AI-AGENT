"""Project, run, task and durable event foundations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_platform_core"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("repository_url", sa.String(500)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("slug", name="uq_projects_slug"),
    )
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requirement", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="created"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('created','planning','waiting_approval','running','blocked',"
            "'completed','failed','cancelled')",
            name="ck_runs_status",
        ),
    )
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="backlog"),
        sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role IN ('pm','ba','be','fe','test','devops')", name="ck_tasks_role"),
    )
    op.create_index("ix_tasks_run_id", "tasks", ["run_id"])
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("idempotency_key", sa.String(160)),
        sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_events_idempotency_key"),
    )
    op.create_index("ix_events_run_id_id", "events", ["run_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_events_run_id_id", table_name="events")
    op.drop_table("events")
    op.drop_index("ix_tasks_run_id", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_runs_project_id", table_name="runs")
    op.drop_table("runs")
    op.drop_table("projects")
