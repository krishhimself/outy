"""Sign up, sign in, profile, and password reset."""

import hashlib
import hmac
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import resend
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from app.config import EMERGENT_SESSION_DATA_URL, GOOGLE_AUTH_ENABLED
from app.database import PROJECTION, db
from app.ratelimit import TOO_MANY, client_ip, limiter
from app.security import (
    create_session, ensure_unique_username, gen_unique_username, get_current_user,
    hash_password, normalize_username, session_query, validate_new_password, verify_password,
)
from app.utils import gen_code, now_dt, now_iso


logger = logging.getLogger(__name__)
router = APIRouter()

MAX_NAME_LENGTH = 60
MAX_AVATAR_CHARS = 2_000_000  # about 1.5 MB of image data
AVATAR_DATA_URI = re.compile(r"^data:image/(jpeg|jpg|png|webp|gif|heic|heif);base64,")

OTP_TTL_MINUTES = 15
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60

SIGNIN_MAX_FAILURES = 8          # per email
SIGNIN_LOCK_SECONDS = 15 * 60


class User(BaseModel):
    id: str
    email: str
    name: str
    username: str
    avatar_url: Optional[str] = None
    auth_provider: str  # "password" | "google"
    invite_code: str
    created_at: str


def public_user(doc: dict) -> dict:
    """Strip sensitive fields and _id from a user document for JSON responses."""
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash", "google_sub")}


def clean_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Name must be {MAX_NAME_LENGTH} characters or fewer")
    return name


class SignupPayload(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)
    name: str = Field(max_length=200)
    username: str = Field(max_length=64)


class SigninPayload(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class GoogleSessionPayload(BaseModel):
    session_token: str = Field(max_length=500)


class ClaimUsernamePayload(BaseModel):
    username: str = Field(max_length=64)


class UpdateProfilePayload(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    avatar_url: Optional[str] = Field(default=None, max_length=MAX_AVATAR_CHARS)


@router.post("/auth/signup")
async def signup(payload: SignupPayload, request: Request):
    limiter.check(f"signup-ip:{client_ip(request)}", limit=20, window=3600)
    validate_new_password(payload.password)
    name = clean_name(payload.name)
    email = payload.email.lower()
    username = normalize_username(payload.username)
    await ensure_unique_username(username)
    if await db.users.find_one({"email": email}, PROJECTION):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": name,
        "username": username,
        "avatar_url": None,
        "auth_provider": "password",
        "password_hash": hash_password(payload.password),
        "invite_code": gen_code(6),
        "created_at": now_iso(),
    }
    try:
        await db.users.insert_one(user_doc)
    except DuplicateKeyError:
        # two sign-ups raced for the same email or username
        raise HTTPException(status_code=409, detail="Email or username already taken")
    token = await create_session(user_doc["id"])
    return {"token": token, "user": public_user(user_doc), "needs_username": False}


@router.post("/auth/signin")
async def signin(payload: SigninPayload, request: Request):
    email = payload.email.lower()
    limiter.check(f"signin-ip:{client_ip(request)}", limit=60, window=300)
    fail_key = f"signin-fail:{email}"
    if limiter.is_blocked(fail_key, SIGNIN_MAX_FAILURES, SIGNIN_LOCK_SECONDS):
        raise HTTPException(status_code=429, detail=TOO_MANY)

    user = await db.users.find_one({"email": email}, PROJECTION)
    password_ok = bool(
        user
        and user.get("password_hash")
        and verify_password(payload.password, user["password_hash"])
    )
    if not password_ok:
        limiter.record(fail_key)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    limiter.reset(fail_key)
    token = await create_session(user["id"])
    return {"token": token, "user": public_user(user), "needs_username": False}


@router.post("/auth/google/session")
async def google_session(payload: GoogleSessionPayload):
    """Exchange an Emergent OAuth session for an Outy session. Off unless GOOGLE_AUTH_ENABLED=true."""
    if not GOOGLE_AUTH_ENABLED:
        raise HTTPException(status_code=404, detail="Google sign-in is not available")
    headers = {"X-Session-ID": payload.session_token}
    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            res = await hc.get(EMERGENT_SESSION_DATA_URL, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach auth service")
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google session")
    data = res.json()
    email = (data.get("email") or "").lower()
    name = (data.get("name") or "Friend")[:MAX_NAME_LENGTH]
    picture = data.get("picture")
    if not email:
        raise HTTPException(status_code=400, detail="Google session missing email")

    existing = await db.users.find_one({"email": email}, PROJECTION)
    if existing:
        user_doc = existing
        needs_username = False
    else:
        # New user: generate a temporary username, the app then asks them to pick one
        temp_username = await gen_unique_username(email.split("@")[0])
        user_doc = {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": name,
            "username": temp_username,
            "avatar_url": picture,
            "auth_provider": "google",
            "invite_code": gen_code(6),
            "created_at": now_iso(),
        }
        await db.users.insert_one(user_doc)
        needs_username = True

    # Always issue our own token; never reuse one a third party has seen.
    token = await create_session(user_doc["id"])
    return {"token": token, "user": public_user(user_doc), "needs_username": needs_username}


@router.post("/auth/username")
async def claim_username(payload: ClaimUsernamePayload, current=Depends(get_current_user)):
    new_username = normalize_username(payload.username)
    await ensure_unique_username(new_username, allow_user_id=current["id"])
    try:
        await db.users.update_one({"id": current["id"]}, {"$set": {"username": new_username}})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Username already taken")
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@router.get("/auth/me")
async def auth_me(current=Depends(get_current_user)):
    return {"user": public_user(dict(current))}


@router.put("/auth/me")
async def update_me(payload: UpdateProfilePayload, current=Depends(get_current_user)):
    update: dict = {}
    if payload.name is not None and payload.name != "":
        update["name"] = clean_name(payload.name)
    if payload.avatar_url:
        avatar = payload.avatar_url
        if not (avatar.startswith("https://") or AVATAR_DATA_URI.match(avatar)):
            raise HTTPException(status_code=400, detail="Profile photo must be an image")
        update["avatar_url"] = avatar
    if update:
        await db.users.update_one({"id": current["id"]}, {"$set": update})
        # keep the copy of this person inside every crew list in step
        member_update = {f"members.$.{field}": value for field, value in update.items()}
        await db.outings.update_many({"members.user_id": current["id"]}, {"$set": member_update})
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one(session_query(authorization[7:].strip()))
    return {"ok": True}


# ---------- Password reset ----------
class ForgotPasswordPayload(BaseModel):
    email: EmailStr


class VerifyOTPPayload(BaseModel):
    email: EmailStr
    otp: str = Field(max_length=12)


class ResetPasswordPayload(BaseModel):
    email: EmailStr
    otp: str = Field(max_length=12)
    new_password: str = Field(max_length=200)


def _hash_otp(email: str, otp: str) -> str:
    return hashlib.sha256(f"{email}:{otp}".encode()).hexdigest()


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _check_otp(email: str, otp: str) -> None:
    """Raise 400 unless `otp` is the live reset code for `email`. Wrong guesses are
    counted, and the code is destroyed after OTP_MAX_ATTEMPTS of them."""
    record = await db.password_resets.find_one({"email": email}, PROJECTION)
    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    if _parse_time(record["expires_at"]) < now_dt():
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")
    if record.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Too many wrong attempts. Request a new code.")
    if not hmac.compare_digest(record.get("otp_hash", ""), _hash_otp(email, otp.strip())):
        attempts = record.get("attempts", 0) + 1
        if attempts >= OTP_MAX_ATTEMPTS:
            await db.password_resets.delete_many({"email": email})
            raise HTTPException(status_code=400, detail="Too many wrong attempts. Request a new code.")
        await db.password_resets.update_one({"email": email}, {"$set": {"attempts": attempts}})
        raise HTTPException(status_code=400, detail="Invalid code")


@router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordPayload, request: Request):
    """Always answers {"ok": true}, so the response never reveals whether an email has an account."""
    email = payload.email.lower()
    limiter.check(f"forgot-ip:{client_ip(request)}", limit=20, window=3600)
    user = await db.users.find_one({"email": email}, PROJECTION)
    if not user or not user.get("password_hash"):
        return {"ok": True}

    existing = await db.password_resets.find_one({"email": email}, PROJECTION)
    if existing:
        age = (now_dt() - _parse_time(existing["created_at"])).total_seconds()
        if age < OTP_RESEND_COOLDOWN_SECONDS:
            return {"ok": True}  # a code was just sent; don't send another yet

    otp = f"{secrets.randbelow(1_000_000):06d}"
    await db.password_resets.delete_many({"email": email})
    await db.password_resets.insert_one({
        "email": email,
        "otp_hash": _hash_otp(email, otp),
        "attempts": 0,
        "expires_at": (now_dt() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        "created_at": now_iso(),
    })
    try:
        resend.Emails.send({
            "from": "Outy <onboarding@resend.dev>",
            "to": [email],
            "subject": "Your Outy password reset code",
            "html": f"""
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
                <h2 style="color: #FF6B6B;">Reset your Outy password</h2>
                <p>Your one-time code is:</p>
                <h1 style="letter-spacing: 8px; color: #1C1E21; font-size: 48px;">{otp}</h1>
                <p style="color: #888;">This code expires in {OTP_TTL_MINUTES} minutes.</p>
                <p style="color: #888;">If you didn't request this, ignore this email.</p>
            </div>
            """,
        })
    except Exception as e:
        logger.error("Could not send reset email: %s", e)
    return {"ok": True}


@router.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOTPPayload):
    await _check_otp(payload.email.lower(), payload.otp)
    return {"ok": True}


@router.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordPayload):
    email = payload.email.lower()
    validate_new_password(payload.new_password)
    await _check_otp(email, payload.otp)
    user = await db.users.find_one({"email": email}, PROJECTION)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    await db.password_resets.delete_many({"email": email})
    # Sign out every device: whoever knew the old password loses access too.
    await db.user_sessions.delete_many({"user_id": user["id"]})
    limiter.reset(f"signin-fail:{email}")
    return {"ok": True}
