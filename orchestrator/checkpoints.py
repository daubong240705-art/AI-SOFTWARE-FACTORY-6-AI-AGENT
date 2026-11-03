from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from sqlalchemy.engine import make_url

from shared.config import get_settings


@contextmanager
def checkpointer() -> Iterator[PostgresSaver]:
    url = make_url(get_settings().database_url.get_secret_value()).set(drivername="postgresql")
    # Separate schema keeps framework-owned migrations out of Alembic autogeneration.
    with psycopg.connect(
        url.render_as_string(hide_password=False),
        autocommit=True,
        row_factory=dict_row,
        prepare_threshold=0,
        options="-c search_path=asf_checkpoints",
    ) as connection:
        yield PostgresSaver(connection)


if __name__ == "__main__":
    with checkpointer() as saver:
        saver.setup()
