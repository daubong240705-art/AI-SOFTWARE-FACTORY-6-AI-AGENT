"""Durable SSE: reconnect cursors replay PostgreSQL history, including across restarts."""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from asf_api.auth import COOKIE, UserDep, authenticate
from asf_api.db import SessionLocal
from asf_api.models import Event, Run

router = APIRouter(prefix="/api")


def read_events(run_id: uuid.UUID, after: int, token: str | None) -> list[dict[str, Any]]:
    authenticate(token)  # Also checks revocation and expiry during an open stream.
    with SessionLocal() as session:
        if not session.get(Run, run_id):
            raise HTTPException(404, "run_not_found")
        return [
            {
                "id": e.id,
                "kind": e.kind,
                "payload": e.payload,
                "simulated": e.simulated,
                "created_at": e.created_at.isoformat(),
            }
            for e in session.scalars(
                select(Event)
                .where(Event.run_id == run_id, Event.id > after)
                .order_by(Event.id)
                .limit(100)
            )
        ]


def cursor(after: int, last_id: str | None) -> int:
    try:
        value = int(last_id or "0")
        if value < 0 or value > 9223372036854775807:
            raise ValueError
        return max(after, value)
    except ValueError:
        raise HTTPException(422, "invalid_event_cursor") from None


@router.get("/runs/{run_id}/stream")
async def stream(
    run_id: uuid.UUID,
    request: Request,
    _: UserDep,
    after: Annotated[int, Query(ge=0, le=9223372036854775807)] = 0,
) -> StreamingResponse:
    position = cursor(after, request.headers.get("last-event-id"))
    token = request.cookies.get(COOKIE)
    initial = await run_in_threadpool(read_events, run_id, position, token)

    async def generate() -> AsyncIterator[str]:
        nonlocal position
        rows = initial
        started = time.monotonic()
        yield "retry: 2000\n\n"
        while time.monotonic() - started < 50:
            if await request.is_disconnected():
                return
            for row in rows:
                position = row["id"]
                yield f"id: {position}\nevent: timeline\ndata: {json.dumps(row)}\n\n"
            if len(rows) < 100:
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)
            try:
                rows = await run_in_threadpool(read_events, run_id, position, token)
            except HTTPException as exc:
                name = "session-expired" if exc.status_code == 401 else "unavailable"
                yield f"event: {name}\ndata: {{}}\n\n"
                return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
