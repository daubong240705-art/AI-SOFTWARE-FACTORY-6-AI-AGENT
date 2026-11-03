"""durable workflow approvals model usage and dispatch"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_workflow"
down_revision = "0001_platform_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('created','planning','waiting_approval','running','blocked',"
        "'completed','failed','cancelled','rejected','waiting_integration')",
    )
    op.execute("CREATE SCHEMA IF NOT EXISTS asf_checkpoints")

    op.create_table(
        "artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("spec_version", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("simulated", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('plan','spec')", name="ck_artifacts_kind"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "spec_version", "kind", name="uq_artifacts_version_kind"),
    )
    op.create_table(
        "dispatches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("delivery", sa.Integer(), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "generation", name="uq_dispatch_generation"),
    )
    op.create_index(op.f("ix_dispatches_run_id"), "dispatches", ["run_id"], unique=False)
    op.create_table(
        "model_calls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("spec_version", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("charged_tokens", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_model_calls_run_id"), "model_calls", ["run_id"], unique=False)
    op.create_table(
        "approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("artifact_id", sa.Uuid(), nullable=False),
        sa.Column("spec_version", sa.Integer(), nullable=False),
        sa.Column("spec_hash", sa.String(length=64), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("decision IN ('approve','reject')", name="ck_approvals_decision"),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_approvals_key"),
        sa.UniqueConstraint("run_id", "spec_version", name="uq_approvals_version"),
    )
    op.add_column(
        "runs", sa.Column("mode", sa.String(length=16), server_default="mock", nullable=False)
    )
    op.add_column(
        "runs", sa.Column("spec_version", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column("runs", sa.Column("generation", sa.Integer(), server_default="1", nullable=False))
    op.add_column(
        "runs", sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column(
        "runs", sa.Column("token_budget", sa.Integer(), server_default="100000", nullable=False)
    )
    op.add_column("runs", sa.Column("call_limit", sa.Integer(), server_default="6", nullable=False))
    op.add_column("runs", sa.Column("error_code", sa.String(length=80), nullable=True))
    op.create_index(
        "uq_runs_one_active",
        "runs",
        [sa.literal_column("(1)")],
        unique=True,
        postgresql_where=sa.text("status IN ('created','planning','waiting_approval','running')"),
    )
    op.add_column(
        "tasks", sa.Column("spec_version", sa.Integer(), server_default="1", nullable=False)
    )
    op.create_unique_constraint(
        "uq_tasks_version_role", "tasks", ["run_id", "spec_version", "role"]
    )


def downgrade() -> None:
    # Operational rollback: stop workers first. Checkpoint history belongs to this phase.
    op.execute("DROP SCHEMA IF EXISTS asf_checkpoints CASCADE")
    op.execute(
        "UPDATE runs SET status='blocked' WHERE status IN ('rejected','waiting_integration')"
    )
    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('created','planning','waiting_approval','running','blocked',"
        "'completed','failed','cancelled')",
    )

    op.drop_constraint("uq_tasks_version_role", "tasks", type_="unique")
    op.drop_column("tasks", "spec_version")
    op.drop_index(
        "uq_runs_one_active",
        table_name="runs",
        postgresql_where=sa.text("status IN ('created','planning','waiting_approval','running')"),
    )
    op.drop_column("runs", "error_code")
    op.drop_column("runs", "call_limit")
    op.drop_column("runs", "token_budget")
    op.drop_column("runs", "retry_count")
    op.drop_column("runs", "generation")
    op.drop_column("runs", "spec_version")
    op.drop_column("runs", "mode")
    op.drop_table("approvals")
    op.drop_index(op.f("ix_model_calls_run_id"), table_name="model_calls")
    op.drop_table("model_calls")
    op.drop_index(op.f("ix_dispatches_run_id"), table_name="dispatches")
    op.drop_table("dispatches")
    op.drop_table("artifacts")
