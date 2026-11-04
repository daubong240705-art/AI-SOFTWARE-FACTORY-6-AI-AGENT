import logging
import signal
import time
from datetime import UTC, datetime, timedelta

from asf_api.db import SessionLocal
from asf_api.models import Dispatch, Run
from redis import Redis
from rq import Queue
from rq.serializers import JSONSerializer
from sqlalchemy import or_, select

from orchestrator.service import event, fail_tasks
from orchestrator.state import EXECUTABLE
from shared.config import get_settings
from shared.logging import configure_logging


def sweep() -> int:
    settings = get_settings()
    redis = Redis.from_url(
        settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=2
    )
    queue = Queue(settings.queue_name, connection=redis, serializer=JSONSerializer)
    count = 0
    try:
        with SessionLocal() as session:
            ids = list(
                session.scalars(
                    select(Dispatch.id)
                    .where(
                        Dispatch.state != "done",
                        or_(Dispatch.state == "pending", Dispatch.lease_until < datetime.now(UTC)),
                    )
                    .limit(20)
                )
            )
        for dispatch_id in ids:
            with SessionLocal.begin() as session:
                record = session.get(Dispatch, dispatch_id)
                if not record:
                    continue
                run = session.scalar(
                    select(Run).where(Run.id == record.run_id).with_for_update(skip_locked=True)
                )
                if run is None:
                    continue
                session.refresh(record)
                if record.state == "done" or (
                    record.state != "pending"
                    and record.lease_until
                    and record.lease_until > datetime.now(UTC)
                ):
                    continue
                if run.generation != record.generation or run.status not in (
                    *EXECUTABLE,
                    "waiting_approval",
                ):
                    record.state = "done"
                    continue
                if record.delivery >= settings.dispatch_recovery_limit + 1:
                    run.status, run.error_code = "failed", "worker_recovery_limit"
                    record.state = "done"
                    fail_tasks(session, run)
                    event(session, run, "run.failed", {"code": run.error_code})
                    continue
                record.delivery += 1
                record.state = "enqueued"
                record.lease_until = datetime.now(UTC) + timedelta(
                    seconds=settings.dispatch_lease_seconds
                )
                # DB commits after enqueue. If it fails, the stale delivery is a no-op;
                # the pending outbox is retried. If Redis loses a job, the lease expires.
                queue.enqueue(
                    "workers.jobs.execute",
                    str(record.id),
                    record.delivery,
                    job_id=f"asf-{record.id}-{record.delivery}",
                    job_timeout=900,
                    result_ttl=3600,
                    failure_ttl=3600,
                )
                if record.delivery > 1:
                    event(session, run, "worker.redelivered", {"delivery": record.delivery})
                count += 1
    finally:
        redis.close()
    return count


def main() -> None:
    configure_logging(get_settings().log_level)
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not stopping:
        try:
            sweep()
            from workers.execution_recovery import sweep as recover_executions

            recover_executions()
        except Exception:
            logging.getLogger(__name__).warning("Dispatch unavailable; durable outbox retained")
        time.sleep(2)


if __name__ == "__main__":
    main()
