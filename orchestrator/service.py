import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from asf_api.models import (
    Approval,
    Artifact,
    Dispatch,
    Event,
    Execution,
    ModelCall,
    Project,
    Run,
    Task,
)
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from agents.contracts import ROLES
from orchestrator.state import ACTIVE, EXECUTABLE, Superseded, WorkflowError, transition
from shared.config import get_settings
from shared.profiles import model_selection, profiles


@dataclass(frozen=True)
class Fence:
    dispatch_id: uuid.UUID
    generation: int
    delivery: int


def event(session: Session, run: Run, kind: str, payload: dict[str, Any]) -> None:
    session.add(Event(run_id=run.id, kind=kind, payload=payload, simulated=run.mode == "mock"))


def get_run(session: Session, run_id: uuid.UUID, fence: Fence | None = None) -> Run:
    run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
    if run is None:
        raise WorkflowError("run_not_found")
    if fence:
        dispatch = session.get(Dispatch, fence.dispatch_id)
        if (
            not dispatch
            or dispatch.state != "running"
            or dispatch.delivery != fence.delivery
            or run.generation != fence.generation
            or run.status not in (*EXECUTABLE, "waiting_approval")
        ):
            raise Superseded()
    return run


def reserve_slot(session: Session, run_id: uuid.UUID | None = None) -> None:
    # Serialize API create/retry transactions; the partial unique index is the final guard.
    session.execute(text("SELECT pg_advisory_xact_lock(240702)"))
    active = select(Run.id).where(Run.status.in_(ACTIVE))
    if run_id:
        active = active.where(Run.id != run_id)
    if session.scalar(active):
        raise WorkflowError("active_run_exists")


def dispatch_run(session: Session, run: Run) -> None:
    session.add(Dispatch(run_id=run.id, generation=run.generation))


def add_tasks(session: Session, run: Run) -> None:
    for role, capability in ROLES.items():
        available = capability["implemented"] and (
            role in {"pm", "ba"} or (run.mode == "live" and run.config_snapshot.get("integration"))
        )
        session.add(
            Task(
                run_id=run.id,
                role=role,
                title=f"{role.upper()} / v{run.spec_version}",
                spec_version=run.spec_version,
                status="pending" if available else "not_implemented",
                simulated=run.mode == "mock" and bool(available),
            )
        )


def create_run(session: Session, project_id: uuid.UUID, requirement: str, mode: str) -> Run:
    if not session.get(Project, project_id):
        raise WorkflowError("project_not_found")
    if mode == "live" and not get_settings().live_mode_enabled:
        raise WorkflowError("live_mode_disabled")
    reserve_slot(session)
    settings = get_settings()
    project = session.get(Project, project_id)
    assert project
    try:
        snapshot: dict[str, Any] = {"models": model_selection(project.agent_models)}
    except ValueError:
        raise WorkflowError("model_not_allowed") from None
    if project.integration_profile:
        profile = profiles().get(project.integration_profile)
        if not profile or not profile.enabled:
            raise WorkflowError("integration_profile_disabled")
        snapshot["integration"] = profile.model_dump()
    run = Run(
        project_id=project_id,
        requirement=requirement,
        mode=mode,
        token_budget=settings.run_token_budget,
        call_limit=settings.run_call_limit,
        config_snapshot=snapshot,
    )
    session.add(run)
    session.flush()
    add_tasks(session, run)
    dispatch_run(session, run)
    event(session, run, "run.created", {"mode": mode, "spec_version": 1})
    return run


def artifact(session: Session, run: Run, kind: str) -> Artifact | None:
    return session.scalar(
        select(Artifact).where(
            Artifact.run_id == run.id,
            Artifact.spec_version == run.spec_version,
            Artifact.kind == kind,
        )
    )


def store_artifact(session: Session, run: Run, role: str, content: dict[str, Any]) -> Artifact:
    kind = "plan" if role == "pm" else "spec"
    if kind not in ROLES.get(role, {}).get("writes", []):
        raise WorkflowError("role_permission_denied")
    existing = artifact(session, run, kind)
    if existing:
        return existing
    digest = hashlib.sha256(
        json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    result = Artifact(
        run_id=run.id,
        spec_version=run.spec_version,
        kind=kind,
        content=content,
        content_hash=digest,
        simulated=run.mode == "mock",
    )
    session.add(result)
    task = session.scalar(
        select(Task).where(
            Task.run_id == run.id, Task.spec_version == run.spec_version, Task.role == role
        )
    )
    if task:
        task.status = "completed"
    event(
        session,
        run,
        "artifact.created",
        {"kind": kind, "spec_version": run.spec_version, "content_hash": digest},
    )
    session.flush()
    return result


def decide(
    session: Session,
    run_id: uuid.UUID,
    version: int,
    spec_hash: str,
    decision: str,
    actor: str,
    comment: str,
    key: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
) -> Approval:
    run = get_run(session, run_id)
    previous = session.scalar(select(Approval).where(Approval.idempotency_key == key))
    if previous:
        if (
            previous.run_id,
            previous.spec_version,
            previous.spec_hash,
            previous.decision,
            previous.actor,
            previous.comment,
            previous.actor_user_id,
        ) == (run_id, version, spec_hash, decision, actor, comment, actor_user_id):
            return previous
        raise WorkflowError("idempotency_conflict")
    spec = artifact(session, run, "spec")
    if run.status != "waiting_approval":
        raise WorkflowError("invalid_transition")
    if not spec or version != run.spec_version or spec_hash != spec.content_hash:
        raise WorkflowError("stale_spec")
    approval = Approval(
        run_id=run.id,
        artifact_id=spec.id,
        spec_version=version,
        spec_hash=spec_hash,
        decision=decision,
        actor=actor,
        actor_user_id=actor_user_id,
        identity_source="authenticated_session" if actor_user_id else "legacy_unverified_dev",
        comment=comment,
        idempotency_key=key,
    )
    session.add(approval)
    run.status = transition(run.status, "running" if decision == "approve" else "rejected")
    run.generation += 1  # Fence every pre-approval worker, including checkpoint write gaps.
    if decision == "approve":
        dispatch_run(session, run)
    event(
        session,
        run,
        "approval.recorded",
        {
            "spec_version": version,
            "spec_hash": spec_hash,
            "decision": decision,
            "actor": actor,
            "comment": comment,
            "identity_source": approval.identity_source,
            "actor_user_id": str(actor_user_id) if actor_user_id else None,
        },
    )
    session.flush()
    return approval


def retry_run(session: Session, run_id: uuid.UUID, comment: str) -> Run:
    reserve_slot(session, run_id)
    run = get_run(session, run_id)
    if run.status not in ("failed", "rejected"):
        raise WorkflowError("invalid_transition")
    if run.retry_count >= get_settings().run_retry_limit:
        raise WorkflowError("retry_limit")
    if run.status == "rejected":
        run.spec_version += 1
        add_tasks(session, run)
    run.status = transition(run.status, "created")
    run.generation += 1
    run.retry_count += 1
    run.error_code = None
    for task in session.scalars(
        select(Task).where(
            Task.run_id == run.id,
            Task.spec_version == run.spec_version,
            Task.status.in_(("failed", "running")),
        )
    ):
        task.status = "pending"
    dispatch_run(session, run)
    event(
        session,
        run,
        "run.retried",
        {"spec_version": run.spec_version, "comment": comment, "retry_count": run.retry_count},
    )
    return run


def cancel_run(session: Session, run_id: uuid.UUID, comment: str) -> Run:
    run = get_run(session, run_id)
    if run.status == "cancelled":
        return run
    run.status = transition(run.status, "cancelled")
    run.generation += 1
    for item in session.scalars(
        select(Execution).where(
            Execution.run_id == run.id,
            Execution.state.in_(("pending", "leased", "waiting_release")),
        )
    ):
        item.state = "cancelled"
        item.lease_token_hash = None
    for task in session.scalars(
        select(Task).where(Task.run_id == run.id, Task.status.in_(("pending", "running")))
    ):
        task.status = "cancelled"
    event(session, run, "run.cancelled", {"comment": comment})
    return run


def fail_tasks(session: Session, run: Run) -> None:
    for task in session.scalars(
        select(Task).where(
            Task.run_id == run.id, Task.spec_version == run.spec_version, Task.status == "running"
        )
    ):
        task.status = "failed"


def usage(session: Session, run_id: uuid.UUID) -> dict[str, Any]:
    calls, charged, inputs, outputs = session.execute(
        select(
            func.count(ModelCall.id),
            func.coalesce(func.sum(ModelCall.charged_tokens), 0),
            func.sum(ModelCall.input_tokens),
            func.sum(ModelCall.output_tokens),
        ).where(ModelCall.run_id == run_id)
    ).one()
    return {
        "calls": calls,
        "charged_tokens": charged,
        "input_tokens": inputs,
        "output_tokens": outputs,
        "cost": None,
    }
