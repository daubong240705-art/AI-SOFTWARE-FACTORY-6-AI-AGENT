"""Integration targets, frozen model choices, remote worker leases and release gates."""

import sqlalchemy as sa
from alembic import op

revision = "0004_agents"
down_revision = "0003_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("integration_profile", sa.String(80)))
    op.add_column(
        "projects", sa.Column("agent_models", sa.JSON(), nullable=False, server_default="{}")
    )
    op.add_column(
        "runs", sa.Column("config_snapshot", sa.JSON(), nullable=False, server_default="{}")
    )
    # PostgreSQL JSONB is used consistently with the application metadata.
    op.execute(
        "ALTER TABLE projects ALTER COLUMN agent_models TYPE jsonb USING agent_models::jsonb"
    )
    op.execute(
        "ALTER TABLE runs ALTER COLUMN config_snapshot TYPE jsonb USING config_snapshot::jsonb"
    )
    op.execute("""CREATE TABLE external_links (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      kind varchar(40) NOT NULL, version integer NOT NULL, external_id varchar(120) NOT NULL,
      url varchar(500) NOT NULL, data jsonb NOT NULL,
      CONSTRAINT uq_external_link UNIQUE(run_id,kind,version))""")
    op.execute("""CREATE TABLE coding_workers (
      id uuid PRIMARY KEY, name varchar(80) NOT NULL UNIQUE, token_hash varchar(64) NOT NULL UNIQUE,
      capabilities jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
      last_seen_at timestamptz)""")
    op.execute("""CREATE TABLE executions (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      role varchar(16) NOT NULL, attempt integer NOT NULL, state varchar(24) NOT NULL,
      worker_id uuid REFERENCES coding_workers(id), lease_token_hash varchar(64),
      lease_until timestamptz, deadline timestamptz, generation integer NOT NULL,
      input jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_execution_attempt UNIQUE(run_id,role,attempt))""")
    op.create_index("ix_executions_run_id", "executions", ["run_id"])
    op.execute("""CREATE TABLE release_approvals (
      id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      actor_user_id uuid NOT NULL REFERENCES users(id), candidate_sha varchar(40) NOT NULL,
      pipeline_id integer NOT NULL, job_id integer NOT NULL, comment text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_release_execution UNIQUE(execution_id))""")
    op.execute("""CREATE TABLE webhook_deliveries (
      delivery_id varchar(128) PRIMARY KEY, project_id integer NOT NULL,
      payload_hash varchar(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    for table in [
        "webhook_deliveries",
        "release_approvals",
        "executions",
        "coding_workers",
        "external_links",
    ]:
        op.drop_table(table)
    op.drop_column("runs", "config_snapshot")
    op.drop_column("projects", "agent_models")
    op.drop_column("projects", "integration_profile")
