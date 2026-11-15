"""Plans waiting for a person to approve them.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proposals",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("proposal", sa.Text, nullable=False),
        sa.Column("created_at", sa.String, nullable=False),
        sa.Column("decided_at", sa.String, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("proposals")
