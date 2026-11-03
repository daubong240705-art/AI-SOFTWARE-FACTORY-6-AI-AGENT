import logging
import threading
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from asf_api.db import SessionLocal, engine
from asf_api.models import Approval, Dispatch
from langgraph.types import Command
from sqlalchemy import select, text

from orchestrator.checkpoints import checkpointer
from orchestrator.graph import build_graph
from orchestrator.service import Fence, event, fail_tasks, get_run
from orchestrator.state import EXECUTABLE, Superseded, WorkflowError, transition
from shared.config import get_settings

logger = logging.getLogger(__name__)


def heartbeat(run_id: uuid.UUID, fence: Fence, stop: threading.Event) -> None:
    settings = get_settings()
    while not stop.wait(settings.dispatch_lease_seconds / 3):
        try:
            with SessionLocal.begin() as session:
                get_run(session, run_id, fence)
                dispatch = session.get(Dispatch, fence.dispatch_id)
                assert dispatch
                dispatch.lease_until = datetime.now(UTC) + timedelta(
                    seconds=settings.dispatch_lease_seconds
                )
        except Superseded:
            return
        except Exception:
            logger.warning("Worker lease renewal failed")


def execute(dispatch_id: str, delivery: int) -> None:
    dispatch_uuid = uuid.UUID(dispatch_id)
    with SessionLocal() as session:
        row = session.get(Dispatch, dispatch_uuid)
        if not row:
            return
        run_id, generation = row.run_id, row.generation
    fence = Fence(dispatch_uuid, generation, delivery)
    # Session advisory lock also protects LangGraph writes against overlapping redelivery.
    with engine.connect() as lock:
        acquired = lock.scalar(
            text("SELECT pg_try_advisory_lock(hashtextextended(:key, 0))"), {"key": str(run_id)}
        )
        lock.commit()
        if not acquired:
            return  # Lease dispatcher will retry; never execute two graphs for one run.
        stop = threading.Event()
        thread: threading.Thread | None = None
        try:
            with SessionLocal.begin() as session:
                run = get_run(session, run_id)
                dispatch = session.get(Dispatch, dispatch_uuid)
                if (
                    not dispatch
                    or dispatch.delivery != delivery
                    or dispatch.state != "enqueued"
                    or run.generation != generation
                    or run.status not in (*EXECUTABLE, "waiting_approval")
                ):
                    return
                dispatch.state = "running"
                dispatch.lease_until = datetime.now(UTC) + timedelta(
                    seconds=get_settings().dispatch_lease_seconds
                )
                version, status = run.spec_version, run.status
                if status == "created":
                    approved = session.scalar(
                        select(Approval.id).where(
                            Approval.run_id == run.id,
                            Approval.spec_version == version,
                            Approval.decision == "approve",
                        )
                    )
                    run.status = "running" if approved else "planning"
                    status = run.status
                    event(
                        session,
                        run,
                        "run.resumed" if approved else "run.planning",
                        {"spec_version": version},
                    )
            thread = threading.Thread(target=heartbeat, args=(run_id, fence, stop), daemon=True)
            thread.start()
            with checkpointer() as saver:
                graph = build_graph(saver, fence)
                config = {"configurable": {"thread_id": f"{run_id}:v{version}"}}
                snapshot = graph.get_state(config)
                if not snapshot.values:
                    graph.invoke(
                        {
                            "run_id": str(run_id),
                            "spec_version": version,
                            "plan_id": "",
                            "spec_id": "",
                        },
                        config,
                    )
                elif snapshot.next:
                    value: Command[Any] | None = (
                        Command(resume=True)
                        if status == "running" and any(task.interrupts for task in snapshot.tasks)
                        else None
                    )
                    graph.invoke(value, config)
                with SessionLocal.begin() as session:
                    run = get_run(session, run_id)
                    dispatch = session.get(Dispatch, dispatch_uuid)
                    if dispatch and dispatch.delivery == delivery and run.generation == generation:
                        dispatch.state = "done"
                        dispatch.lease_until = None
        except Superseded:
            pass
        except Exception as exc:
            code = exc.code if isinstance(exc, WorkflowError) else "workflow_error"
            # Do not persist raw gateway/DB exceptions or prompt content.
            logger.warning("Workflow failed: %s", code)
            with SessionLocal.begin() as session:
                run = get_run(session, run_id)
                dispatch = session.get(Dispatch, dispatch_uuid)
                if (
                    dispatch
                    and dispatch.delivery == delivery
                    and run.generation == generation
                    and run.status in (*EXECUTABLE, "waiting_approval")
                ):
                    run.status = transition(run.status, "failed")
                    run.error_code = code
                    dispatch.state = "done"
                    fail_tasks(session, run)
                    event(session, run, "run.failed", {"code": code})
        finally:
            stop.set()
            if thread:
                thread.join(timeout=5)
            lock.execute(
                text("SELECT pg_advisory_unlock(hashtextextended(:key, 0))"), {"key": str(run_id)}
            )
            lock.commit()
