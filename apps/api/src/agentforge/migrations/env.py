"""Alembic environment for the run store.

`RunStore` passes its own connection in `config.attributes`; the command line
(`alembic -c apps/api/alembic.ini ...`) connects to the URL in the ini file instead.
"""

from alembic import context
from sqlalchemy import engine_from_config, pool

from agentforge.store import METADATA

config = context.config
if context.is_offline_mode():
    raise RuntimeError("offline (--sql) migrations are not supported")


def run(connection) -> None:
    # Batch mode: SQLite cannot alter most columns in place, so Alembic copies the table.
    context.configure(connection=connection, target_metadata=METADATA, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


connection = config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    engine = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with engine.connect() as connection:
        run(connection)
