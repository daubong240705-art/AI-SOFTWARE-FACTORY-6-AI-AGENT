from datetime import UTC, datetime

from asf_api.db import SessionLocal
from asf_api.models import Execution, Run
from sqlalchemy import select

from orchestrator.executions import fail


def sweep() -> None:
    """Enforce deadlines even if every remote worker is offline."""
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        ids = list(
            session.scalars(
                select(Execution.id)
                .where(
                    Execution.state.in_(("pending", "leased")),
                    Execution.deadline < now,
                )
                .limit(20)
            )
        )
        for item_id in ids:
            item = session.get(Execution, item_id)
            if not item:
                continue
            run = session.scalar(
                select(Run).where(Run.id == item.run_id).with_for_update(skip_locked=True)
            )
            if not run:
                continue
            session.refresh(item)
            if item.state not in {"pending", "leased"} or not item.deadline or item.deadline >= now:
                continue
            if run.status == "running" and run.generation == item.input["run_generation"]:
                fail(session, run, item, "execution_timeout")
            else:
                item.state = "cancelled"
