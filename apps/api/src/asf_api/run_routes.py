import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agents.contracts import ROLES
from asf_api.db import get_session
from asf_api.models import Approval, Artifact, Event, ModelCall, Run, Task
from orchestrator import service
from orchestrator.state import WorkflowError
from shared.config import get_settings

router = APIRouter(prefix="/api")
SessionDep = Annotated[Session, Depends(get_session)]


def dev_only() -> None:
    if get_settings().environment not in ("development", "test"):
        raise HTTPException(
            403, "Phase 2 workflow requires local dev; authentication comes in Phase 3"
        )


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RunCreate(Input):
    requirement: str = Field(min_length=1, max_length=12000)
    mode: Literal["mock", "live"] = "mock"


class Comment(Input):
    comment: str = Field(min_length=1, max_length=2000)


class Review(Comment):
    spec_version: int = Field(ge=1)
    spec_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    decision: Literal["approve", "reject"]
    actor: str = Field(min_length=1, max_length=120)
    idempotency_key: uuid.UUID


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    requirement: str
    status: str
    mode: str
    spec_version: int
    generation: int
    retry_count: int
    token_budget: int
    call_limit: int
    error_code: str | None
    created_at: datetime
    updated_at: datetime


def commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            409, "Concurrent change or idempotency conflict; reload current state"
        ) from None


def problem(exc: WorkflowError) -> HTTPException:
    return HTTPException(
        404 if exc.code in ("run_not_found", "project_not_found") else 409, exc.code
    )


@router.get("/roles")
def roles() -> dict[str, Any]:
    return {"roles": ROLES, "approval": "human_only", "identity": "unverified_local_dev"}


@router.post(
    "/projects/{project_id}/runs",
    response_model=RunRead,
    status_code=201,
    dependencies=[Depends(dev_only)],
)
def create(project_id: uuid.UUID, payload: RunCreate, session: SessionDep) -> Run:
    try:
        run = service.create_run(session, project_id, payload.requirement, payload.mode)
        commit(session)
        return run
    except WorkflowError as exc:
        raise problem(exc) from None


@router.get("/projects/{project_id}/runs")
def list_runs(
    project_id: uuid.UUID,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    from asf_api.models import Project

    if not session.get(Project, project_id):
        raise HTTPException(404, "project_not_found")
    where = Run.project_id == project_id
    rows = session.scalars(
        select(Run).where(where).order_by(Run.created_at.desc(), Run.id).limit(limit).offset(offset)
    )
    return {
        "items": [RunRead.model_validate(run).model_dump(mode="json") for run in rows],
        "total": session.scalar(select(func.count()).select_from(Run).where(where)),
        "limit": limit,
        "offset": offset,
    }


@router.get("/runs/{run_id}")
def detail(run_id: uuid.UUID, session: SessionDep) -> dict[str, Any]:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run_not_found")
    tasks = session.scalars(
        select(Task).where(Task.run_id == run_id).order_by(Task.spec_version, Task.role)
    )
    artifacts = session.scalars(
        select(Artifact)
        .where(Artifact.run_id == run_id)
        .order_by(Artifact.spec_version, Artifact.kind)
    )
    reviews = session.scalars(
        select(Approval).where(Approval.run_id == run_id).order_by(Approval.spec_version)
    )
    calls = session.scalars(
        select(ModelCall)
        .where(ModelCall.run_id == run_id)
        .order_by(ModelCall.created_at, ModelCall.id)
    )
    return {
        "run": RunRead.model_validate(run).model_dump(mode="json"),
        "tasks": [
            {
                "role": t.role,
                "status": t.status,
                "spec_version": t.spec_version,
                "simulated": t.simulated,
            }
            for t in tasks
        ],
        "artifacts": [
            {
                "id": str(a.id),
                "kind": a.kind,
                "spec_version": a.spec_version,
                "content": a.content,
                "content_hash": a.content_hash,
                "simulated": a.simulated,
            }
            for a in artifacts
        ],
        "approvals": [
            {
                "id": str(a.id),
                "spec_version": a.spec_version,
                "spec_hash": a.spec_hash,
                "decision": a.decision,
                "actor": a.actor,
                "comment": a.comment,
                "created_at": a.created_at.isoformat(),
            }
            for a in reviews
        ],
        "usage": service.usage(session, run_id),
        "model_calls": [
            {
                "id": str(c.id),
                "spec_version": c.spec_version,
                "role": c.role,
                "status": c.status,
                "model": c.model,
                "charged_tokens": c.charged_tokens,
                "input_tokens": c.input_tokens,
                "output_tokens": c.output_tokens,
                "latency_ms": c.latency_ms,
                "error_code": c.error_code,
            }
            for c in calls
        ],
    }


@router.get("/runs/{run_id}/events")
def events(
    run_id: uuid.UUID,
    session: SessionDep,
    after: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, Any]:
    if not session.get(Run, run_id):
        raise HTTPException(404, "run_not_found")
    rows = list(
        session.scalars(
            select(Event)
            .where(Event.run_id == run_id, Event.id > after)
            .order_by(Event.id)
            .limit(limit)
        )
    )
    return {
        "items": [
            {
                "id": e.id,
                "kind": e.kind,
                "payload": e.payload,
                "simulated": e.simulated,
                "created_at": e.created_at.isoformat(),
            }
            for e in rows
        ],
        "next_after": rows[-1].id if rows else after,
    }


@router.post("/runs/{run_id}/approval", dependencies=[Depends(dev_only)])
def review(run_id: uuid.UUID, payload: Review, session: SessionDep) -> dict[str, Any]:
    try:
        decision = service.decide(
            session,
            run_id,
            payload.spec_version,
            payload.spec_hash,
            payload.decision,
            payload.actor,
            payload.comment,
            payload.idempotency_key,
        )
        commit(session)
        return {
            "id": str(decision.id),
            "decision": decision.decision,
            "spec_version": decision.spec_version,
            "identity_source": "unverified_local_dev",
        }
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/runs/{run_id}/retry", response_model=RunRead, dependencies=[Depends(dev_only)])
def retry(run_id: uuid.UUID, payload: Comment, session: SessionDep) -> Run:
    try:
        run = service.retry_run(session, run_id, payload.comment)
        commit(session)
        return run
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/runs/{run_id}/cancel", response_model=RunRead, dependencies=[Depends(dev_only)])
def cancel(run_id: uuid.UUID, payload: Comment, session: SessionDep) -> Run:
    try:
        run = service.cancel_run(session, run_id, payload.comment)
        commit(session)
        return run
    except WorkflowError as exc:
        raise problem(exc) from None
