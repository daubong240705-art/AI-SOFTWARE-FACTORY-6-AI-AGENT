import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agents.contracts import ROLES
from asf_api.auth import OperatorDep, current_user
from asf_api.db import get_session
from asf_api.models import Approval, Artifact, AuditLog, Event, ModelCall, Run, Task
from orchestrator import service
from orchestrator.state import WorkflowError

router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])
SessionDep = Annotated[Session, Depends(get_session)]


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
    return {"roles": ROLES, "approval": "human_only", "identity": "authenticated_session"}


@router.post(
    "/projects/{project_id}/runs",
    response_model=RunRead,
    status_code=201,
)
def create(
    project_id: uuid.UUID, payload: RunCreate, session: SessionDep, actor: OperatorDep
) -> Run:
    try:
        run = service.create_run(session, project_id, payload.requirement, payload.mode)
        session.add(AuditLog(user_id=actor.id, action="run.created", target=str(run.id)))
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
                "actor_user_id": str(a.actor_user_id) if a.actor_user_id else None,
                "identity_source": a.identity_source,
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
    after: Annotated[int, Query(ge=0, le=9223372036854775807)] = 0,
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


@router.post("/runs/{run_id}/approval")
def review(
    run_id: uuid.UUID, payload: Review, session: SessionDep, actor: OperatorDep
) -> dict[str, Any]:
    try:
        decision = service.decide(
            session,
            run_id,
            payload.spec_version,
            payload.spec_hash,
            payload.decision,
            actor.username,
            payload.comment,
            payload.idempotency_key,
            actor.id,
        )
        session.add(
            AuditLog(user_id=actor.id, action="approval." + payload.decision, target=str(run_id))
        )
        commit(session)
        return {
            "id": str(decision.id),
            "decision": decision.decision,
            "spec_version": decision.spec_version,
            "identity_source": decision.identity_source,
        }
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/runs/{run_id}/retry", response_model=RunRead)
def retry(run_id: uuid.UUID, payload: Comment, session: SessionDep, actor: OperatorDep) -> Run:
    try:
        run = service.retry_run(session, run_id, payload.comment)
        session.add(AuditLog(user_id=actor.id, action="run.retried", target=str(run_id)))
        commit(session)
        return run
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/runs/{run_id}/cancel", response_model=RunRead)
def cancel(run_id: uuid.UUID, payload: Comment, session: SessionDep, actor: OperatorDep) -> Run:
    try:
        run = service.cancel_run(session, run_id, payload.comment)
        session.add(AuditLog(user_id=actor.id, action="run.cancelled", target=str(run_id)))
        commit(session)
        return run
    except WorkflowError as exc:
        raise problem(exc) from None
