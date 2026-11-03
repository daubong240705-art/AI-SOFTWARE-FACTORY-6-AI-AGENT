import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from redis import Redis
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from asf_api.auth import (
    COOKIE,
    AdminDep,
    UserDep,
    check_origin,
    csrf_token,
    hash_password,
    token_hash,
    verify_password,
)
from asf_api.db import SessionLocal
from asf_api.models import AuditLog, LoginSession, User
from shared.config import get_settings

router = APIRouter(prefix="/api")
# Equal-cost verification for unknown accounts; never a real account password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=128)


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    username: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,39}$")
    password: str = Field(min_length=12, max_length=128)
    role: Literal["viewer", "approver", "admin"]


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["viewer", "approver", "admin"]
    active: bool


def public_user(user: User) -> dict[str, object]:
    return {"id": str(user.id), "username": user.username, "role": user.role, "active": user.active}


def recheck_admin(session: Session, actor_id: uuid.UUID) -> None:
    # Serialize admin mutations, then recheck after waiting for a concurrent demotion.
    session.execute(text("SELECT pg_advisory_xact_lock(240703)"))
    actor = session.get(User, actor_id)
    if not actor or not actor.active or actor.role != "admin":
        raise HTTPException(403, "admin_required")


def rate_limit(request: Request, username: str) -> None:
    settings = get_settings()
    try:
        with Redis.from_url(
            settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=2
        ) as redis:
            for scope, value, maximum in [
                ("account", username, 10),
                ("peer", request.client.host if request.client else "unknown", 100),
            ]:
                key = "asf:login:" + scope + ":" + token_hash(value)
                count = redis.eval(
                    "local n=redis.call('INCR',KEYS[1]); "
                    "if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n",
                    1,
                    key,
                )
                if int(count) > maximum:
                    raise HTTPException(429, "login_rate_limited")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "login_unavailable") from None


@router.post("/auth/login")
def login(payload: Login, request: Request, response: Response) -> dict[str, object]:
    check_origin(request)
    username = payload.username.strip().lower()
    rate_limit(request, username)
    with SessionLocal.begin() as session:
        user = session.scalar(select(User).where(User.username == username).with_for_update())
        valid = verify_password(payload.password, user.password_hash if user else DUMMY_HASH)
        if not valid or not user or not user.active:
            session.add(AuditLog(action="login.failed", target=username))
            # Commit failed attempts as well, without password or session token.
            session.commit()
            raise HTTPException(401, "invalid_credentials")
        old = request.cookies.get(COOKIE)
        if old:
            session.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(old)))
        session.execute(delete(LoginSession).where(LoginSession.expires_at <= datetime.now(UTC)))
        token = secrets.token_urlsafe(32)
        session.add(
            LoginSession(
                token_hash=token_hash(token),
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(hours=get_settings().session_hours),
            )
        )
        session.add(AuditLog(user_id=user.id, action="login.succeeded", target=username))
        result: dict[str, object] = {"user": public_user(user), "csrf_token": csrf_token(token)}
    settings = get_settings()
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=settings.session_hours * 3600,
        secure=settings.session_cookie_secure or settings.environment in ("staging", "production"),
    )
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/auth/me")
def me(request: Request, user: UserDep) -> dict[str, object]:
    return {
        "user": {"id": str(user.id), "username": user.username, "role": user.role},
        "csrf_token": csrf_token(request.cookies[COOKIE]),
    }


@router.post("/auth/logout")
def logout(request: Request, response: Response, user: UserDep) -> dict[str, bool]:
    with SessionLocal.begin() as session:
        session.execute(
            delete(LoginSession).where(
                LoginSession.token_hash == token_hash(request.cookies[COOKIE])
            )
        )
        session.add(AuditLog(user_id=user.id, action="logout", target=user.username))
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="lax")
    return {"ok": True}


@router.get("/users")
def users(_: AdminDep) -> dict[str, object]:
    with SessionLocal() as session:
        return {
            "items": [public_user(u) for u in session.scalars(select(User).order_by(User.username))]
        }


@router.post("/users", status_code=201)
def create_user(payload: UserCreate, actor: AdminDep) -> dict[str, object]:
    try:
        with SessionLocal.begin() as session:
            recheck_admin(session, actor.id)
            user = User(
                username=payload.username,
                password_hash=hash_password(payload.password),
                role=payload.role,
            )
            session.add(user)
            session.flush()
            session.add(AuditLog(user_id=actor.id, action="user.created", target=user.username))
            return public_user(user)
    except IntegrityError:
        raise HTTPException(409, "username_exists") from None


@router.patch("/users/{user_id}")
def update_user(user_id: uuid.UUID, payload: UserUpdate, actor: AdminDep) -> dict[str, object]:
    with SessionLocal.begin() as session:
        recheck_admin(session, actor.id)
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(404, "user_not_found")
        if user.id == actor.id and (payload.role != "admin" or not payload.active):
            raise HTTPException(409, "cannot_demote_current_admin")
        if user.role == "admin" and user.active and (payload.role != "admin" or not payload.active):
            count = session.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin", User.active.is_(True))
            )
            if count == 1:
                raise HTTPException(409, "last_admin_required")
        user.role, user.active = payload.role, payload.active
        session.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        session.add(AuditLog(user_id=actor.id, action="user.updated", target=user.username))
        return public_user(user)
