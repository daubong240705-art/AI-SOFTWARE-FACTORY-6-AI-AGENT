"""Offline account bootstrap. No default users/passwords or public registration."""

import argparse
import getpass
import json
import sys

from pydantic import ValidationError
from sqlalchemy import select

from asf_api.auth import hash_password
from asf_api.auth_routes import UserCreate
from asf_api.db import SessionLocal
from asf_api.models import AuditLog, User


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", default="admin")
    parser.add_argument("--role", choices=["viewer", "approver", "admin"], default="admin")
    parser.add_argument("--stdin-json", action="store_true", help="Read JSON from secure stdin")
    args = parser.parse_args()
    try:
        payload = (
            UserCreate.model_validate(json.load(sys.stdin))
            if args.stdin_json
            else UserCreate(
                username=args.username,
                role=args.role,
                password=getpass.getpass("Password (12+ chars): "),
            )
        )
    except (ValidationError, ValueError):
        raise SystemExit(
            "Invalid account input; username 3–40, password 12–128, valid role required"
        ) from None
    with SessionLocal.begin() as session:
        if session.scalar(select(User.id).where(User.username == payload.username)):
            raise SystemExit("Account exists; use the authenticated admin UI")
        user = User(
            username=payload.username,
            role=payload.role,
            password_hash=hash_password(payload.password),
        )
        session.add(user)
        session.flush()
        session.add(AuditLog(user_id=user.id, action="user.bootstrap", target=user.username))
    print("Account created. Password not logged.")


if __name__ == "__main__":
    main()
