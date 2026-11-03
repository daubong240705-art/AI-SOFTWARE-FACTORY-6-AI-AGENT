"""Persistent user sessions and verified approval identities."""

import sqlalchemy as sa
from alembic import op

revision = "0003_auth"
down_revision = "0002_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("username", sa.String(40), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role IN ('viewer','approver','admin')", name="ck_users_role"),
    )
    op.create_table(
        "login_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_login_sessions_user_id", "login_sessions", ["user_id"])
    op.create_index("ix_login_sessions_expires_at", "login_sessions", ["expires_at"])
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("target", sa.String(120), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.add_column("approvals", sa.Column("actor_user_id", sa.Uuid(), nullable=True))
    op.add_column(
        "approvals",
        sa.Column(
            "identity_source", sa.String(40), nullable=False, server_default="legacy_unverified_dev"
        ),
    )
    op.create_foreign_key(
        "fk_approvals_actor_user", "approvals", "users", ["actor_user_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_approvals_actor_user", "approvals", type_="foreignkey")
    op.drop_column("approvals", "identity_source")
    op.drop_column("approvals", "actor_user_id")
    op.drop_table("audit_logs")
    op.drop_table("login_sessions")
    op.drop_table("users")
