import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field

from .config import settings
from .store import PostgresStore


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class AdminIdentity(BaseModel):
    id: int
    email: str
    display_name: str | None = None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_organization_email(email: str) -> bool:
    return email.rsplit("@", 1)[-1] == settings.normalized_organization_domain


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(derived).decode()


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt),
            n=int(n), r=int(r), p=int(p), dklen=32,
        )
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def session_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_session_hours * 3600,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def auth_dependency(store: PostgresStore):
    async def current_admin(session: str | None = Cookie(default=None, alias=settings.auth_cookie_name)) -> AdminIdentity:
        if not session:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        row = await store.get_admin_for_session(session_digest(session))
        if row is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
        return AdminIdentity(id=row["id"], email=row["email"], display_name=row["display_name"])
    return current_admin


async def sign_in(store: PostgresStore, request: LoginRequest, response: Response) -> AdminIdentity:
    email = normalize_email(str(request.email))
    # Use one generic failure response to avoid revealing approved admin emails.
    row = await store.get_admin_by_email(email) if is_organization_email(email) else None
    if row is None or not row["is_active"] or not verify_password(request.password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.auth_session_hours)
    await store.create_admin_session(session_digest(token), row["id"], expires_at)
    set_session_cookie(response, token)
    return AdminIdentity(id=row["id"], email=row["email"], display_name=row["display_name"])
