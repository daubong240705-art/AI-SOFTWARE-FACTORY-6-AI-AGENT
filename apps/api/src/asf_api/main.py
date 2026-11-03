import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis import Redis
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from asf_api.auth import OperatorDep, UserDep
from asf_api.auth_routes import router as auth_router
from asf_api.db import engine, get_session
from asf_api.models import AuditLog, Project
from asf_api.run_routes import router
from asf_api.schemas import ProjectCreate, ProjectList, ProjectRead
from asf_api.stream import router as stream_router
from shared.config import get_settings
from shared.logging import configure_logging

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("asf.api")
redis_client: Redis = Redis.from_url(
    settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=2
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    redis_client.close()
    engine.dispose()


app = FastAPI(title="AI Software Factory", version="0.1.0", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(stream_router)
app.include_router(router)
SessionDep = Annotated[Session, Depends(get_session)]


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message},
            "request_id": getattr(request.state, "request_id", None),
        },
    )


@app.middleware("http")
async def request_context(request: Request, call_next: Any) -> Any:
    request.state.request_id = str(uuid.uuid4())
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request error", extra={"request_id": request.state.request_id})
        response = error_response(request, 500, "internal_error", "An unexpected error occurred")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-ID"] = request.state.request_id
    # Log method/path only: query strings and request bodies can contain secrets.
    logger.info(
        "%s %s %s %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        (time.monotonic() - started) * 1000,
        extra={"request_id": request.state.request_id},
    )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return error_response(request, exc.status_code, f"http_{exc.status_code}", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, _: RequestValidationError) -> JSONResponse:
    # Do not echo invalid input, especially credential-bearing repository URLs.
    return error_response(request, 422, "validation_error", "Invalid request fields")


@app.get("/healthz")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "asf-api",
        "version": app.version,
        "release_sha": settings.release_sha,
    }


@app.get("/readyz")
def readiness() -> JSONResponse:
    checks = {"database": False, "redis": False, "schema": False}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            checks["database"] = True
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            checkpoints = connection.execute(
                text("SELECT to_regclass('asf_checkpoints.checkpoints') IS NOT NULL")
            ).scalar()
            checks["schema"] = version == "0003_auth" and bool(checkpoints)
    except Exception:
        logger.warning("Database readiness check failed")
    try:
        checks["redis"] = bool(redis_client.ping())
    except Exception:
        logger.warning("Redis readiness check failed")
    ready = all(checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


@app.post("/api/projects", response_model=ProjectRead, status_code=201)
def create_project(payload: ProjectCreate, session: SessionDep, actor: OperatorDep) -> Project:
    project = Project(**payload.model_dump())
    session.add(project)
    session.add(AuditLog(user_id=actor.id, action="project.created", target=project.slug))
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise HTTPException(409, "Project slug already exists") from None
        raise
    return project


@app.get("/api/projects", response_model=ProjectList)
def list_projects(
    session: SessionDep,
    _: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    total = session.scalar(select(func.count()).select_from(Project)) or 0
    projects = session.scalars(
        select(Project).order_by(Project.created_at.desc(), Project.id).offset(offset).limit(limit)
    ).all()
    return {"items": projects, "total": total, "limit": limit, "offset": offset}


@app.get("/api/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: uuid.UUID, session: SessionDep, _: UserDep) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project
