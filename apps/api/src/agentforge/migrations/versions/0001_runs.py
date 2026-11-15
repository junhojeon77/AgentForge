"""Runs, their tasks, attempts and transitions.

Revision ID: 0001
Revises:
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("plan", sa.Text, nullable=False),
        sa.Column("created_at", sa.String, nullable=False),
        sa.Column("updated_at", sa.String, nullable=False),
    )
    op.create_table(
        "tasks",
        sa.Column("run_id", sa.String, sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column("task_id", sa.String, primary_key=True),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("state", sa.Text, nullable=False),
    )
    op.create_table(
        "attempts",
        sa.Column("run_id", sa.String, sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column("task_id", sa.String, primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("attempt", sa.Text, nullable=False),
    )
    op.create_table(
        "transitions",
        sa.Column("run_id", sa.String, sa.ForeignKey("runs.id"), primary_key=True),
        sa.Column("sequence", sa.Integer, primary_key=True),
        sa.Column("task_id", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("detail", sa.Text, nullable=False),
    )


def downgrade() -> None:
    for table in ("transitions", "attempts", "tasks", "runs"):
        op.drop_table(table)
