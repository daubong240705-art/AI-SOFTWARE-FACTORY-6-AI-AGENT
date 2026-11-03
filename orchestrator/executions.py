"""Remote execution scheduling. Run row lock serializes claim, finish and cancellation."""

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

from asf_api.auth import token_hash
from asf_api.models import CodingWorker, Execution, ExternalLink, ModelCall, Run, Task
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from integrations.services import GitLab, sync_work_package
from orchestrator.service import artifact, event, get_run, usage
from orchestrator.state import WorkflowError
from shared.config import get_settings
from shared.profiles import IntegrationProfile, allowed_file

ROLES = ("be", "fe", "test", "devops")


def task_state(session: Session, run: Run, role: str, state: str) -> None:
    task = session.scalar(
        select(Task).where(
            Task.run_id == run.id, Task.role == role, Task.spec_version == run.spec_version
        )
    )
    if task:
        task.status = state


def schedule(
    session: Session, run: Run, role: str, candidate: str | None = None, force: bool = False
) -> Execution:
    existing = session.scalar(
        select(Execution)
        .where(
            Execution.run_id == run.id,
            Execution.role == role,
            Execution.input["run_generation"].as_integer() == run.generation,
        )
        .order_by(Execution.attempt.desc())
    )
    if existing and not force:
        return existing
    profile = IntegrationProfile.model_validate(run.config_snapshot["integration"])
    gl = GitLab(profile.gitlab_project_id)
    if candidate is None:
        candidate = gl.get("/repository/branches/" + quote(profile.default_branch, safe=""))[
            "commit"
        ]["id"]
    spec = artifact(session, run, "spec")
    if not spec:
        raise WorkflowError("spec_missing")
    first = session.scalar(
        select(Execution)
        .where(Execution.run_id == run.id)
        .order_by(Execution.created_at, Execution.id)
    )
    attempt = (
        session.scalar(
            select(func.max(Execution.attempt)).where(
                Execution.run_id == run.id, Execution.role == role
            )
        )
        or 0
    ) + 1
    item = Execution(
        run_id=run.id,
        role=role,
        attempt=attempt,
        input={
            "run_generation": run.generation,
            "candidate_sha": candidate,
            "baseline_sha": first.input.get("baseline_sha") if first else candidate,
            "profile": profile.model_dump(),
            "models": run.config_snapshot["models"],
            "spec": spec.content,
            "spec_hash": spec.content_hash,
        },
    )
    session.add(item)
    session.flush()
    task_state(session, run, role, "pending")
    event(
        session,
        run,
        "execution.scheduled",
        {"execution_id": str(item.id), "role": role, "candidate_sha": candidate},
    )
    return item


def start(session: Session, run: Run) -> bool:
    if run.mode != "live" or not run.config_snapshot.get("integration"):
        return False
    schedule(session, run, "be")
    return True


def fail(session: Session, run: Run, item: Execution, code: str) -> None:
    item.state = "failed"
    task_state(session, run, item.role, "failed")
    run.status, run.error_code = "failed", code
    event(session, run, "execution.failed", {"execution_id": str(item.id), "code": code})


def claim(session: Session, worker: CodingWorker) -> dict[str, Any] | None:
    settings = get_settings()
    now = datetime.now(UTC)
    worker.last_seen_at = now
    # A worker identity owns at most one lease; worker restart waits for lease expiry.
    if session.scalar(
        select(Execution.id).where(
            Execution.worker_id == worker.id,
            Execution.state == "leased",
            Execution.lease_until > now,
        )
    ):
        return None
    ids = list(
        session.scalars(
            select(Execution.id)
            .where(
                Execution.state.in_(("pending", "leased")),
                Execution.role.in_(worker.capabilities),
            )
            .order_by(Execution.created_at)
            .limit(30)
        )
    )
    for item_id in ids:
        item = session.get(Execution, item_id)
        assert item
        run = session.scalar(
            select(Run).where(Run.id == item.run_id).with_for_update(skip_locked=True)
        )
        if not run:
            continue
        session.refresh(item)
        if item.state not in {"pending", "leased"}:
            continue
        if run.status != "running" or item.input["run_generation"] != run.generation:
            item.state = "cancelled"
            continue
        if item.state == "leased" and item.lease_until and item.lease_until > now:
            continue
        if item.generation > settings.worker_recovery_limit + 1:
            fail(session, run, item, "execution_recovery_limit")
            continue
        if item.deadline and item.deadline <= now:
            fail(session, run, item, "execution_timeout")
            continue
        profile = IntegrationProfile.model_validate(item.input["profile"])
        if item.role in {"be", "fe"}:
            used = usage(session, run.id)
            reserve = 20000
            if (
                used["calls"] >= run.call_limit
                or used["charged_tokens"] + reserve > run.token_budget
            ):
                fail(session, run, item, "model_budget_exceeded")
                continue
            call = ModelCall(
                run_id=run.id,
                spec_version=run.spec_version,
                role=item.role,
                model=item.input["models"][item.role],
                charged_tokens=reserve,
                status="reserved",
            )
            session.add(call)
            session.flush()
            item.input = {**item.input, "model_call_id": str(call.id)}
        # Recheck profile is frozen, no caller-supplied repository or command is executed.
        files = (
            GitLab(profile.gitlab_project_id).snapshot(item.input["candidate_sha"])
            if item.role in {"be", "fe", "test"}
            else {}
        )
        lease = secrets.token_urlsafe(32)
        item.state, item.worker_id = "leased", worker.id
        item.lease_token_hash = token_hash(lease)
        item.lease_until = now + timedelta(seconds=settings.worker_lease_seconds)
        if not item.deadline:
            item.deadline = now + timedelta(seconds=settings.worker_task_timeout_seconds)
        item.generation += 1
        task_state(session, run, item.role, "running")
        event(
            session,
            run,
            "execution.claimed",
            {"execution_id": str(item.id), "worker": worker.name, "role": item.role},
        )
        baseline = (
            GitLab(profile.gitlab_project_id).snapshot(item.input["baseline_sha"])
            if item.role == "test"
            else {}
        )
        trusted = {
            path.removeprefix("tests/"): value
            for path, value in baseline.items()
            if path.startswith("tests/")
        }
        # Repository fetch time does not consume the worker's first lease interval.
        now = datetime.now(UTC)
        item.lease_until = now + timedelta(seconds=settings.worker_lease_seconds)
        return {
            "id": str(item.id),
            "role": item.role,
            "lease_token": lease,
            "lease_seconds": settings.worker_lease_seconds,
            "timeout_seconds": max(1, int((item.deadline - now).total_seconds())),
            "input": item.input,
            "files": files,
            "trusted_tests": trusted,
        }
    return None


def owned(
    session: Session, worker: CodingWorker, item_id: uuid.UUID, lease: str, finished: bool = False
) -> tuple[Run, Execution]:
    item = session.get(Execution, item_id)
    if not item:
        raise WorkflowError("execution_not_found")
    run = get_run(session, item.run_id)
    session.refresh(item)
    if (
        item.worker_id != worker.id
        or item.lease_token_hash != token_hash(lease)
        or item.input["run_generation"] != run.generation
    ):
        raise WorkflowError("stale_execution_lease")
    if finished and item.result.get("completion_hash"):
        return run, item
    now = datetime.now(UTC)
    if (
        run.status != "running"
        or item.state != "leased"
        or not item.lease_until
        or item.lease_until <= now
        or not item.deadline
        or item.deadline <= now
    ):
        raise WorkflowError("stale_execution_lease")
    return run, item


def commit_changes(item: Execution, changes: dict[str, str | None]) -> str:
    profile = IntegrationProfile.model_validate(item.input["profile"])
    if len(changes) > 40 or len(json.dumps(changes).encode()) > 500_000:
        raise WorkflowError("change_limit")
    if any(not allowed_file(path, profile) for path in changes):
        raise WorkflowError("change_path_not_allowed")
    gl = GitLab(profile.gitlab_project_id)
    branch = "asf/" + str(item.run_id) + "/" + str(item.id)
    branches = gl.get("/repository/branches", search="^" + branch + "$", per_page=100)
    found = [b for b in branches if b["name"] == branch]
    if found:
        head = found[0]["commit"]
        if head["message"].strip() == "ASF execution " + str(item.id):
            original = gl.snapshot(item.input["candidate_sha"])
            actual = gl.snapshot(head["id"])
            expected = {**original, **{k: v for k, v in changes.items() if v is not None}}
            for key, value in changes.items():
                if value is None:
                    expected.pop(key, None)
            if expected != actual:
                raise WorkflowError("completion_commit_conflict")
            return str(head["id"])
        if head["id"] != item.input["candidate_sha"]:
            raise WorkflowError("branch_changed")
    else:
        gl.post("/repository/branches", {"branch": branch, "ref": item.input["candidate_sha"]})
    if not changes:
        return str(item.input["candidate_sha"])
    original = gl.snapshot(item.input["candidate_sha"])
    actions = [
        {
            "action": ("delete" if value is None else "update" if path in original else "create"),
            "file_path": path,
            **({"content": value} if value is not None else {}),
        }
        for path, value in changes.items()
    ]
    result = gl.post(
        "/repository/commits",
        {"branch": branch, "commit_message": "ASF execution " + str(item.id), "actions": actions},
    )
    return str(result["id"])


def pipeline_check(session: Session, run: Run, item: Execution) -> bool:
    profile = IntegrationProfile.model_validate(item.input["profile"])
    gl = GitLab(profile.gitlab_project_id)
    sha = item.input["candidate_sha"]
    pipelines = gl.get("/pipelines", sha=sha, per_page=100)
    if not pipelines:
        return False
    pipeline = gl.get(f"/pipelines/{pipelines[0]['id']}")
    if pipeline["sha"] != sha:
        raise WorkflowError("pipeline_sha_mismatch")
    jobs = gl.get(f"/pipelines/{pipeline['id']}/jobs", per_page=100)
    if len(jobs) >= 100:
        raise WorkflowError("pipeline_job_limit")
    if any(j["status"] in {"failed", "canceled"} for j in jobs):
        raise WorkflowError("candidate_pipeline_failed")
    release = item.input.get("release_job_id")
    if release:
        job = next((j for j in jobs if j["id"] == release), None)
        if not job or job["commit"]["id"] != sha:
            raise WorkflowError("deploy_job_mismatch")
        if job["status"] == "success":
            item.result = {
                "candidate_sha": sha,
                "pipeline_id": pipeline["id"],
                "deploy_job_id": release,
                "status": "deployed",
            }
            return True
        return False
    if any(
        not any(j["name"] == name and j["status"] == "success" for j in jobs)
        for name in profile.required_ci_jobs
    ):
        return False
    gate = next(
        (j for j in jobs if j["name"] == profile.deploy_job and j["status"] == "manual"), None
    )
    if not gate or gate["commit"]["id"] != sha:
        raise WorkflowError("manual_deploy_gate_missing")
    item.state = "waiting_release"
    item.result = {"candidate_sha": sha, "pipeline_id": pipeline["id"], "job_id": gate["id"]}
    task_state(session, run, "devops", "blocked")
    event(session, run, "release.requested", item.result)
    return False


def complete(
    session: Session, worker: CodingWorker, item_id: uuid.UUID, lease: str, payload: dict[str, Any]
) -> Execution:
    run, item = owned(session, worker, item_id, lease, finished=True)
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    if item.result.get("completion_hash"):
        if item.result["completion_hash"] != digest:
            raise WorkflowError("completion_conflict")
        return item
    if call_id := item.input.get("model_call_id"):
        call = session.get(ModelCall, uuid.UUID(call_id))
        if call:
            # OpenCode CLI does not guarantee complete upstream usage reporting.
            # Keep the reserved charge and mark unknown usage explicitly via null token counts.
            call.status = "succeeded" if payload["succeeded"] else "failed"
            call.error_code = None if payload["succeeded"] else "coding_failed"
    if not payload["succeeded"]:
        fail(session, run, item, "worker_execution_failed")
        item.result = {"completion_hash": digest}
        return item
    sha = item.input["candidate_sha"]
    if item.role in {"be", "fe"}:
        sha = commit_changes(item, payload.get("changes", {}))
        item.result = {
            "candidate_sha": sha,
            "completion_hash": digest,
            "model": item.input["models"][item.role],
        }
    elif item.role == "test":
        report = payload.get("report", {})
        item.result = {"candidate_sha": sha, "report": report, "completion_hash": digest}
        if report.get("exit_code") != 0:
            profile = IntegrationProfile.model_validate(item.input["profile"])
            wp = sync_work_package(
                profile.openproject_project_id,
                profile.bug_type_id,
                f"ASF Bug {item.id}",
                item.result,
            )
            session.add(
                ExternalLink(
                    run_id=run.id,
                    kind="bug",
                    version=item.attempt,
                    external_id=str(wp["id"]),
                    url=(get_settings().openproject_url.rstrip("/") + f"/work_packages/{wp['id']}"),
                    data={},
                )
            )
            be_count = (
                session.scalar(
                    select(func.count())
                    .select_from(Execution)
                    .where(Execution.run_id == run.id, Execution.role == "be")
                )
                or 0
            )
            item.state = "failed"
            task_state(session, run, "test", "failed")
            if be_count < 2:
                followup = schedule(session, run, "be", sha, force=True)
                followup.input = {**followup.input, "test_feedback": report}
                event(session, run, "test.fix_requested", {"execution_id": str(followup.id)})
            else:
                fail(session, run, item, "candidate_tests_failed")
            return item
    else:
        try:
            ready = pipeline_check(session, run, item)
        except WorkflowError as exc:
            if exc.code in {
                "candidate_pipeline_failed",
                "manual_deploy_gate_missing",
                "pipeline_sha_mismatch",
                "deploy_job_mismatch",
            }:
                fail(session, run, item, exc.code)
                return item
            raise
        if not ready:
            if item.state != "waiting_release":
                item.state = "pending"
                # Polling CI is not a crashed-worker recovery.
                item.generation = 1
            return item
        item.result = {**item.result, "completion_hash": digest}
    item.state = "succeeded"
    task_state(session, run, item.role, "completed")
    event(
        session,
        run,
        "execution.succeeded",
        {"execution_id": str(item.id), "role": item.role, "candidate_sha": sha},
    )
    if item.role == "devops":
        run.status = "completed"
        event(session, run, "run.completed", item.result)
    else:
        if item.role == "fe":
            profile = IntegrationProfile.model_validate(item.input["profile"])
            gl = GitLab(profile.gitlab_project_id)
            branch = "asf/" + str(item.run_id) + "/" + str(item.id)
            existing = gl.get("/merge_requests", source_branch=branch, state="opened")
            mr = (
                existing[0]
                if existing
                else gl.post(
                    "/merge_requests",
                    {
                        "source_branch": branch,
                        "target_branch": profile.default_branch,
                        "title": f"Draft: ASF run {run.id}",
                        "description": (
                            f"Approved spec SHA256: {item.input['spec_hash']}\nCandidate: {sha}"
                        ),
                        "remove_source_branch": False,
                    },
                )
            )
            session.add(
                ExternalLink(
                    run_id=run.id,
                    kind="merge_request",
                    version=item.attempt,
                    external_id=str(mr["iid"]),
                    url=mr["web_url"],
                    data={"sha": sha},
                )
            )
        schedule(session, run, ROLES[ROLES.index(item.role) + 1], sha, force=True)
    return item
