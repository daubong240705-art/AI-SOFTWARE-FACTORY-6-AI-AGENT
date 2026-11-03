from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from shared.config import get_settings

engine = create_engine(
    get_settings().database_url.get_secret_value(),
    pool_pre_ping=True,
    connect_args={"connect_timeout": 3},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
