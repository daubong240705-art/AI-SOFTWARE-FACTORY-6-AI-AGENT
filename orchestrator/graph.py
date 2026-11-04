import uuid
from typing import Any

from asf_api.db import SessionLocal
from asf_api.models import Approval, Task
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from sqlalchemy import select

from agents.contracts import mock_content
from integrations.router import generate
from integrations.work_packages import sync
from orchestrator.service import Fence, artifact, event, get_run, store_artifact
from orchestrator.state import WorkflowError, WorkflowState, transition


def build_graph(saver: PostgresSaver, fence: Fence) -> Any:
    def draft(state: WorkflowState, role: str) -> dict[str, str]:
        run_id = uuid.UUID(state["run_id"])
        kind = "plan" if role == "pm" else "spec"
        with SessionLocal.begin() as session:
            run = get_run(session, run_id, fence)
            existing = artifact(session, run, kind)
            if existing:
                return {kind + "_id": str(existing.id)}
            task = session.scalar(
                select(Task).where(
                    Task.run_id == run.id, Task.spec_version == run.spec_version, Task.role == role
                )
            )
            if task:
                task.status = "running"
            if run.status == "created":
                run.status = transition(run.status, "planning")
                event(session, run, "run.planning", {"spec_version": run.spec_version})
            requirement, mode = run.requirement, run.mode
            plan = artifact(session, run, "plan")
            plan_content = plan.content if plan else None
            review = session.scalar(
                select(Approval).where(
                    Approval.run_id == run.id, Approval.spec_version == run.spec_version - 1
                )
            )
            feedback = review.comment if review else None
        content = (
            mock_content(role, requirement)
            if mode == "mock"
            else generate(run_id, role, fence, requirement, plan_content, feedback)
        )
        with SessionLocal.begin() as session:
            run = get_run(session, run_id, fence)
            result = store_artifact(session, run, role, content)
            return {kind + "_id": str(result.id)}

    def pm(state: WorkflowState) -> dict[str, str]:
        result = draft(state, "pm")
        sync(uuid.UUID(state["run_id"]), fence)
        return result

    def ba(state: WorkflowState) -> dict[str, str]:
        result = draft(state, "ba")
        sync(uuid.UUID(state["run_id"]), fence)
        return result

    def gate(state: WorkflowState) -> dict[str, str]:
        with SessionLocal.begin() as session:
            run = get_run(session, uuid.UUID(state["run_id"]), fence)
            spec = artifact(session, run, "spec")
            if spec is None:
                raise WorkflowError("spec_missing")
            review = session.scalar(
                select(Approval).where(
                    Approval.run_id == run.id, Approval.spec_version == run.spec_version
                )
            )
            # Handles approval arriving between the DB commit and interrupt checkpoint.
            if review and review.decision == "approve" and review.spec_hash == spec.content_hash:
                return {}
            if run.status == "planning":
                run.status = transition(run.status, "waiting_approval")
                event(
                    session,
                    run,
                    "approval.requested",
                    {"spec_version": run.spec_version, "spec_hash": spec.content_hash},
                )
            prompt = {
                "spec_id": str(spec.id),
                "spec_version": run.spec_version,
                "spec_hash": spec.content_hash,
            }
        interrupt(prompt)  # No path approves automatically; DB decision is authoritative.
        with SessionLocal.begin() as session:
            run = get_run(session, uuid.UUID(state["run_id"]), fence)
            review = session.scalar(
                select(Approval).where(
                    Approval.run_id == run.id,
                    Approval.spec_version == run.spec_version,
                    Approval.decision == "approve",
                )
            )
            if review is None or review.spec_hash != prompt["spec_hash"]:
                raise WorkflowError("approval_required")
        return {}

    def boundary(state: WorkflowState) -> dict[str, str]:
        from orchestrator.executions import start

        with SessionLocal.begin() as session:
            run = get_run(session, uuid.UUID(state["run_id"]), fence)
            if run.status != "running":
                raise WorkflowError("approval_required")
            if start(session, run):
                return {}
            run.status = transition(run.status, "waiting_integration")
            event(
                session,
                run,
                "run.waiting_integration",
                {"reason": "Live run with an enabled integration profile is required"},
            )
        return {}

    builder = StateGraph(WorkflowState)
    builder.add_node("pm", pm)
    builder.add_node("ba", ba)
    builder.add_node("approval", gate)
    builder.add_node("development_boundary", boundary)
    builder.add_edge(START, "pm")
    builder.add_edge("pm", "ba")
    builder.add_edge("ba", "approval")
    builder.add_edge("approval", "development_boundary")
    builder.add_edge("development_boundary", END)
    return builder.compile(checkpointer=saver)
