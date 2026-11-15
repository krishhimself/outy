"""Password hashing, username rules, sessions, and the auth dependency."""

from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import re
import secrets

import bcrypt
from fastapi import Header, HTTPException

from app.config import SESSION_TTL_DAYS
from app.database import PROJECTION, db
from app.utils import now_dt, now_iso


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")


def normalize_username(raw: str) -> str:
    return raw.strip().lower()


async def ensure_unique_username(username: str, allow_user_id: Optional[str] = None) -> None:
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3-24 chars: lowercase letters, numbers, underscore.")
    existing = await db.users.find_one({"username": username}, PROJECTION)
    if existing and existing["id"] != allow_user_id:
        raise HTTPException(status_code=409, detail="Username already taken")


def slugify_username(seed: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "", seed.lower().replace(" ", "_"))
    if len(s) < 3:
        s = (s + "user")[:24]
    return s[:18]


async def gen_unique_username(seed: str) -> str:
    base = slugify_username(seed) or "outyfan"
    for _ in range(8):
        candidate = f"{base}_{secrets.token_hex(2)}"[:24]
        if not await db.users.find_one({"username": candidate}, PROJECTION):
            return candidate
    return f"user_{secrets.token_hex(4)}"


def hash_token(token: str) -> str:
    """Sessions are stored as a SHA-256 hash, so a database leak does not hand out working tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt ignores anything past 72 bytes


def validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password.encode()) > MAX_PASSWORD_BYTES:
        raise HTTPException(status_code=400, detail="Password is too long")


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = (now_dt() + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    await db.user_sessions.insert_one({
        "session_token": hash_token(token),
        "hashed": True,
        "user_id": user_id,
        "created_at": now_iso(),
        "expires_at": expires,
    })
    return token


def session_query(token: str) -> dict:
    """Match a session by its hash. Sessions created before hashing was added
    are stored raw; they still match here and are upgraded on first use."""
    return {"$or": [
        {"session_token": hash_token(token), "hashed": True},
        {"session_token": token, "hashed": {"$ne": True}},
    ]}


async def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[7:].strip()
    session = await db.user_sessions.find_one(session_query(token), PROJECTION)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    if not session.get("hashed"):
        await db.user_sessions.update_one(
            {"session_token": token, "hashed": {"$ne": True}},
            {"$set": {"session_token": hash_token(token), "hashed": True}},
        )
    try:
        expires = datetime.fromisoformat(session["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session")
    if expires < now_dt():
        await db.user_sessions.delete_one(session_query(token))
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"id": session["user_id"]}, PROJECTION)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
