import hashlib
import hmac
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from asf_api.auth import AdminDep, OperatorDep, token_hash
from asf_api.db import get_session
from asf_api.models import (
    AuditLog,
    CodingWorker,
    Execution,
    ReleaseApproval,
    Run,
    WebhookDelivery,
)
from asf_api.run_routes import commit, problem
from integrations.releases import verify_pipeline
from integrations.services import GitLab
from orchestrator import executions
from orchestrator.service import event, get_run
from orchestrator.state import WorkflowError
from shared.agent_skills import skill_snapshot
from shared.config import get_settings
from shared.profiles import IntegrationProfile

router = APIRouter(prefix="/api")
SessionDep = Annotated[Session, Depends(get_session)]


class WorkerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    capabilities: list[str] = Field(min_length=1, max_length=4)


@router.get("/coding-workers")
def list_workers(
    session: SessionDep,
    actor: AdminDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    rows = session.scalars(
        select(CodingWorker)
        .order_by(CodingWorker.name, CodingWorker.id)
        .limit(limit)
        .offset(offset)
    ).all()
    leases = session.scalars(
        select(Execution)
        .join(Run)
        .where(
            Execution.worker_id.in_([w.id for w in rows]),
            Execution.state == "leased",
            Execution.lease_until > now,
            Run.status == "running",
            Execution.input["run_generation"].as_integer() == Run.generation,
        )
    ).all()
    return {
        "items": [
            {
                "id": str(w.id),
                "name": w.name,
                "active": w.active,
                "capabilities": w.capabilities,
                "last_seen_at": w.last_seen_at,
                "status": (
                    "revoked"
                    if not w.active
                    else "never_connected"
                    if not w.last_seen_at
                    else "online"
                    if (now - w.last_seen_at).total_seconds() < 120
                    else "offline"
                ),
                "executions": [
                    {
                        "id": str(e.id),
                        "run_id": str(e.run_id),
                        "role": e.role,
                        "lease_until": e.lease_until,
                    }
                    for e in leases
                    if e.worker_id == w.id
                ],
            }
            for w in rows
        ],
        "total": session.scalar(select(func.count()).select_from(CodingWorker)),
        "limit": limit,
        "offset": offset,
    }


@router.get("/agent-capabilities")
def agent_capabilities(actor: AdminDep) -> dict[str, Any]:
    settings = get_settings()
    return {
        "roles": skill_snapshot(),
        "models": settings.model_catalog,
        "coding_limits": {
            "requests": settings.coding_model_requests,
            "tokens": settings.coding_model_allowance,
            "output_tokens": settings.coding_model_output_tokens,
        },
        "model_key_in_sandbox": False,
    }


@router.post("/coding-workers", status_code=201)
def register(payload: WorkerCreate, session: SessionDep, actor: AdminDep) -> dict[str, Any]:
    if not set(payload.capabilities) <= set(executions.ROLES):
        raise HTTPException(422, "invalid_capabilities")
    secret = secrets.token_urlsafe(32)
    row = CodingWorker(
        name=payload.name, token_hash=token_hash(secret), capabilities=payload.capabilities
    )
    session.add(row)
    session.add(AuditLog(user_id=actor.id, action="worker.registered", target=payload.name))
    commit(session)
    return {"id": str(row.id), "name": row.name, "token": secret}


@router.delete("/coding-workers/{worker_id}")
def revoke(worker_id: uuid.UUID, session: SessionDep, actor: AdminDep) -> dict[str, bool]:
    row = session.get(CodingWorker, worker_id)
    if not row:
        raise HTTPException(404, "worker_not_found")
    row.active = False
    session.add(AuditLog(user_id=actor.id, action="worker.revoked", target=str(worker_id)))
    commit(session)
    return {"revoked": True}


@router.post("/coding-workers/{worker_id}/rotate")
def rotate(worker_id: uuid.UUID, session: SessionDep, actor: AdminDep) -> dict[str, str]:
    row = session.get(CodingWorker, worker_id)
    if not row or not row.active:
        raise HTTPException(404, "active_worker_not_found")
    secret = secrets.token_urlsafe(32)
    row.token_hash = token_hash(secret)
    session.add(AuditLog(user_id=actor.id, action="worker.rotated", target=str(worker_id)))
    commit(session)
    return {"id": str(row.id), "name": row.name, "token": secret}


def machine(request: Request, session: SessionDep) -> CodingWorker:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not 30 < len(auth) < 128:
        raise HTTPException(401, "worker_authentication_required")
    row = session.scalar(
        select(CodingWorker)
        .where(
            CodingWorker.token_hash == token_hash(auth[7:]),
            CodingWorker.active.is_(True),
        )
        .with_for_update()
    )
    if not row:
        raise HTTPException(401, "worker_authentication_required")
    return row


WorkerDep = Annotated[CodingWorker, Depends(machine)]


class Lease(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease_token: str = Field(min_length=30, max_length=100)


class Completion(Lease):
    succeeded: bool
    changes: dict[str, str | None] = Field(default_factory=dict, max_length=40)
    report: dict[str, Any] = Field(default_factory=dict)

    @field_validator("report")
    @classmethod
    def validate_usage(cls, value: dict[str, Any]) -> dict[str, Any]:
        if "model_usage" not in value:
            return value
        usage = value["model_usage"]
        if not isinstance(usage, dict):
            raise ValueError("invalid_model_usage")
        for key in ("charged_tokens", "physical_requests", "input_tokens", "output_tokens"):
            number = usage.get(key)
            if number is not None and (type(number) is not int or number < 0):
                raise ValueError("invalid_model_usage")
        if usage.get("error_code") is not None and not isinstance(usage["error_code"], str):
            raise ValueError("invalid_model_usage")
        return value


@router.post("/worker/claim")
def claim(session: SessionDep, worker: WorkerDep) -> dict[str, Any]:
    try:
        item = executions.claim(session, worker)
        commit(session)
        return {"execution": item}
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/worker/executions/{item_id}/heartbeat")
def heartbeat(
    item_id: uuid.UUID, payload: Lease, session: SessionDep, worker: WorkerDep
) -> dict[str, bool]:
    try:
        _, item = executions.owned(session, worker, item_id, payload.lease_token)
        item.lease_until = min(
            item.deadline or datetime.now(UTC),
            datetime.now(UTC) + timedelta(seconds=get_settings().worker_lease_seconds),
        )
        worker.last_seen_at = datetime.now(UTC)
        commit(session)
        return {"active": True}
    except WorkflowError as exc:
        raise problem(exc) from None


@router.post("/worker/executions/{item_id}/complete")
def complete(
    item_id: uuid.UUID, payload: Completion, session: SessionDep, worker: WorkerDep
) -> dict[str, str]:
    if len(payload.model_dump_json().encode()) > 600_000:
        raise HTTPException(413, "completion_too_large")
    try:
        item = executions.complete(
            session,
            worker,
            item_id,
            payload.lease_token,
            payload.model_dump(exclude={"lease_token"}),
        )
        commit(session)
        return {"state": item.state}
    except WorkflowError as exc:
        raise problem(exc) from None


class Release(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_sha: str = Field(pattern=r"^[a-f0-9]{40}$")
    pipeline_id: int = Field(gt=0)
    job_id: int = Field(gt=0)
    comment: str = Field(min_length=1, max_length=2000)


@router.post("/executions/{item_id}/release")
def release(
    item_id: uuid.UUID, payload: Release, session: SessionDep, actor: OperatorDep
) -> dict[str, str]:
    item = session.get(Execution, item_id)
    if not item:
        raise HTTPException(404, "execution_not_found")
    run = get_run(session, item.run_id)
    session.refresh(item)
    previous = session.scalar(
        select(ReleaseApproval).where(ReleaseApproval.execution_id == item.id)
    )
    expected = (
        (previous.candidate_sha, previous.pipeline_id, previous.job_id)
        if previous
        else (
            item.result.get("candidate_sha"),
            item.result.get("pipeline_id"),
            item.result.get("job_id"),
        )
    )
    if expected != (payload.candidate_sha, payload.pipeline_id, payload.job_id):
        raise HTTPException(409, "release_candidate_changed")
    if run.status == "completed" and previous:
        return {"status": "recorded"}
    if run.status != "running" or item.state not in {"waiting_release", "pending", "leased"}:
        raise HTTPException(409, "release_not_waiting")
    profile = IntegrationProfile.model_validate(item.input["profile"])
    try:
        gl = GitLab(profile.gitlab_project_id)
        pipeline = gl.get(f"/pipelines/{payload.pipeline_id}")
        verify_pipeline(pipeline, payload.candidate_sha, str(run.id))
        job = gl.get(f"/jobs/{payload.job_id}")
        if (
            pipeline["sha"] != payload.candidate_sha
            or job["commit"]["id"] != payload.candidate_sha
            or job["pipeline"]["id"] != payload.pipeline_id
            or job["name"] != profile.deploy_job
            or job["status"] not in {"manual", "pending", "running", "success"}
        ):
            raise WorkflowError("release_job_mismatch")
        jobs = gl.get(f"/pipelines/{payload.pipeline_id}/jobs", per_page=100)
        if len(jobs) >= 100 or any(
            not any(j["name"] == name and j["status"] == "success" for j in jobs)
            for name in profile.required_ci_jobs
        ):
            raise WorkflowError("release_checks_not_passed")
        if not previous:
            if item.state != "waiting_release":
                raise WorkflowError("release_not_waiting")
            session.add(
                ReleaseApproval(
                    execution_id=item.id,
                    actor_user_id=actor.id,
                    candidate_sha=payload.candidate_sha,
                    pipeline_id=payload.pipeline_id,
                    job_id=payload.job_id,
                    comment=payload.comment,
                )
            )
            item.input = {
                **item.input,
                "release_job_id": payload.job_id,
                "release_pipeline_id": payload.pipeline_id,
            }
            item.state, item.generation, item.deadline = "pending", 1, None
            session.add(AuditLog(user_id=actor.id, action="release.approved", target=str(item.id)))
            event(session, run, "release.approved", payload.model_dump())
        # The host must see a committed approval before CI can reach its deploy boundary.
        commit(session)
        if job["status"] == "manual":
            gl.post(f"/jobs/{payload.job_id}/play", {})
        return {"status": "recorded"}
    except WorkflowError as exc:
        raise problem(exc) from None


class StagingAuthorization(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: int = Field(gt=0)
    candidate_sha: str = Field(pattern=r"^[a-f0-9]{40}$")
    pipeline_id: int = Field(gt=0)
    job_id: int = Field(gt=0)


@router.post("/staging/authorize")
def authorize_stage(
    payload: StagingAuthorization, request: Request, session: SessionDep
) -> dict[str, Any]:
    secret = get_settings().staging_verifier_key.get_secret_value()
    if not secret or not hmac.compare_digest(
        request.headers.get("authorization", ""), "Bearer " + secret
    ):
        raise HTTPException(401, "staging_verifier_required")
    rows = session.execute(
        select(ReleaseApproval, Execution, Run)
        .join(Execution, ReleaseApproval.execution_id == Execution.id)
        .join(Run, Run.id == Execution.run_id)
        .where(
            ReleaseApproval.candidate_sha == payload.candidate_sha,
            ReleaseApproval.pipeline_id == payload.pipeline_id,
            ReleaseApproval.job_id == payload.job_id,
        )
    ).all()
    for approval, item, run in rows:
        if (
            run.status == "running"
            and item.state in {"pending", "leased"}
            and item.input["run_generation"] == run.generation
            and item.input["profile"]["gitlab_project_id"] == payload.project_id
        ):
            return {
                "authorized": True,
                "approval_id": str(approval.id),
                "execution_id": str(item.id),
                **payload.model_dump(),
            }
    raise HTTPException(409, "staging_approval_missing_or_stale")


@router.post("/webhooks/gitlab")
async def webhook(request: Request, session: SessionDep) -> dict[str, bool]:
    secret = get_settings().gitlab_webhook_secret.get_secret_value()
    supplied = request.headers.get("x-gitlab-token", "")
    if not secret or not hmac.compare_digest(secret, supplied):
        raise HTTPException(401, "webhook_authentication_required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 256_000:
            raise HTTPException(413, "webhook_too_large")
    delivery = request.headers.get("x-gitlab-event-uuid", "")
    try:
        uuid.UUID(delivery)
        data = json.loads(body)
        project_id = int(data["project"]["id"])
        sha = data["object_attributes"]["sha"]
        pipeline_id = int(data["object_attributes"]["id"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, "invalid_webhook") from None
    if request.headers.get("x-gitlab-event") != "Pipeline Hook":
        raise HTTPException(422, "unsupported_webhook")
    digest = hashlib.sha256(body).hexdigest()
    old = session.get(WebhookDelivery, delivery)
    if old:
        if old.payload_hash != digest or old.project_id != project_id:
            raise HTTPException(409, "webhook_replay_conflict")
        return {"accepted": True}
    # Webhook is evidence only. Never trust its status to approve or finish an execution.
    matches = session.scalars(
        select(Execution).where(
            Execution.role == "devops",
            Execution.state.in_(("pending", "leased", "waiting_release")),
        )
    ).all()
    matched = [
        e
        for e in matches
        if e.input["profile"]["gitlab_project_id"] == project_id and e.input["candidate_sha"] == sha
    ]
    if not matched:
        raise HTTPException(409, "webhook_candidate_unknown")
    pipeline = GitLab(project_id).get(f"/pipelines/{pipeline_id}")
    if pipeline["sha"] != sha:
        raise HTTPException(409, "webhook_candidate_mismatch")
    session.add(WebhookDelivery(delivery_id=delivery, project_id=project_id, payload_hash=digest))
    for item in matched:
        run = get_run(session, item.run_id)
        event(
            session,
            run,
            "gitlab.pipeline",
            {"pipeline_id": pipeline_id, "sha": sha, "status": pipeline["status"]},
        )
    commit(session)
    return {"accepted": True}
