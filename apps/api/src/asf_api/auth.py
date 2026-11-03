import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from asf_api.db import SessionLocal
from asf_api.models import LoginSession, User
from shared.config import get_settings

COOKIE = "asf_session"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(token: str) -> str:
    return hashlib.sha256(("asf-csrf:" + token).encode()).hexdigest()


@dataclass(frozen=True)
class Principal:
    id: uuid.UUID
    username: str
    role: str


def authenticate(token: str | None) -> Principal:
    if not token or len(token) > 128:
        raise HTTPException(401, "authentication_required")
    with SessionLocal() as session:
        user = session.scalar(
            select(User)
            .join(LoginSession)
            .where(
                LoginSession.token_hash == token_hash(token),
                LoginSession.expires_at > datetime.now(UTC),
                User.active.is_(True),
            )
        )
        if user is None:
            raise HTTPException(401, "session_expired")
        return Principal(user.id, user.username, user.role)


def check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in get_settings().allowed_origins:
        raise HTTPException(403, "invalid_origin")


def current_user(request: Request) -> Principal:
    token = request.cookies.get(COOKIE)
    principal = authenticate(token)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        check_origin(request)
        if not token or not hmac.compare_digest(
            request.headers.get("x-csrf-token", ""), csrf_token(token)
        ):
            raise HTTPException(403, "csrf_required")
    return principal


def operator(user: Annotated[Principal, Depends(current_user)]) -> Principal:
    if user.role not in ("approver", "admin"):
        raise HTTPException(403, "operator_required")
    return user


def administrator(user: Annotated[Principal, Depends(current_user)]) -> Principal:
    if user.role != "admin":
        raise HTTPException(403, "admin_required")
    return user


UserDep = Annotated[Principal, Depends(current_user)]
OperatorDep = Annotated[Principal, Depends(operator)]
AdminDep = Annotated[Principal, Depends(administrator)]
