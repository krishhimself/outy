"""Sign up, sign in, Google session exchange, profile, and password reset."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
import random
import string
import uuid

import httpx
import resend
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr

from app.config import EMERGENT_SESSION_DATA_URL
from app.database import PROJECTION, db
from app.security import (
    create_session, ensure_unique_username, gen_unique_username, get_current_user,
    hash_password, normalize_username, verify_password,
)
from app.utils import gen_code, now_dt, now_iso


logger = logging.getLogger(__name__)
router = APIRouter()


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


class SignupPayload(BaseModel):
    email: EmailStr
    password: str
    name: str
    username: str


class SigninPayload(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionPayload(BaseModel):
    session_token: str  # token returned by Emergent /session-data


class ClaimUsernamePayload(BaseModel):
    username: str


class UpdateProfilePayload(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None


@router.post("/auth/signup")
async def signup(payload: SignupPayload):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 chars")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    email = payload.email.lower()
    username = normalize_username(payload.username)
    await ensure_unique_username(username)
    if await db.users.find_one({"email": email}, PROJECTION):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": payload.name.strip(),
        "username": username,
        "avatar_url": None,
        "auth_provider": "password",
        "password_hash": hash_password(payload.password),
        "invite_code": gen_code(6),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    token = await create_session(user_doc["id"])
    return {"token": token, "user": public_user(user_doc), "needs_username": False}


@router.post("/auth/signin")
async def signin(payload: SigninPayload):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email}, PROJECTION)
    if not user or user.get("auth_provider") != "password":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = await create_session(user["id"])
    return {"token": token, "user": public_user(user), "needs_username": False}


@router.post("/auth/google/session")
async def google_session(payload: GoogleSessionPayload):
    """Exchange the Emergent session_token (from the OAuth redirect) for an Outy session."""
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
    name = data.get("name") or "Friend"
    picture = data.get("picture")
    session_token = data.get("session_token") or payload.session_token
    if not email:
        raise HTTPException(status_code=400, detail="Google session missing email")

    existing = await db.users.find_one({"email": email}, PROJECTION)
    if existing:
        if existing.get("auth_provider") == "password":
            # link Google to an existing account
            await db.users.update_one(
                {"id": existing["id"]},
                {"$set": {"auth_provider": "google", "avatar_url": picture or existing.get("avatar_url")}},
            )
            existing["auth_provider"] = "google"
            existing["avatar_url"] = picture or existing.get("avatar_url")
        user_doc = existing
        needs_username = False  # has username already
    else:
        # New user: generate temp username, ask client to claim a proper one
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

    token = await create_session(user_doc["id"], ext_token=session_token)
    return {"token": token, "user": public_user(user_doc), "needs_username": needs_username}


@router.post("/auth/username")
async def claim_username(payload: ClaimUsernamePayload, current=Depends(get_current_user)):
    new_username = normalize_username(payload.username)
    await ensure_unique_username(new_username, allow_user_id=current["id"])
    await db.users.update_one({"id": current["id"]}, {"$set": {"username": new_username}})
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@router.get("/auth/me")
async def auth_me(current=Depends(get_current_user)):
    return {"user": public_user(dict(current))}


@router.put("/auth/me")
async def update_me(payload: UpdateProfilePayload, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None and v != ""}
    if update:
        await db.users.update_one({"id": current["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": authorization[7:].strip()})
    return {"ok": True}


class ForgotPasswordPayload(BaseModel):
    email: EmailStr

class VerifyOTPPayload(BaseModel):
    email: EmailStr
    otp: str

class ResetPasswordPayload(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

@router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordPayload):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email}, PROJECTION)
    if not user:
        return {"ok": True}
    if user.get("auth_provider") != "password":
        raise HTTPException(status_code=400, detail="This account uses Google Sign In")
    otp = "".join(random.choices(string.digits, k=6))
    expires = (now_dt() + timedelta(minutes=15)).isoformat()
    await db.password_resets.delete_many({"email": email})
    await db.password_resets.insert_one({
        "email": email,
        "otp": otp,
        "expires_at": expires,
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
                <p style="color: #888;">This code expires in 15 minutes.</p>
                <p style="color: #888;">If you didn't request this, ignore this email.</p>
            </div>
            """,
        })
    except Exception as e:
        logger.error(f"Resend error: {e}")
    return {"ok": True}

@router.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOTPPayload):
    email = payload.email.lower()
    record = await db.password_resets.find_one({"email": email}, PROJECTION)
    if not record:
        raise HTTPException(status_code=400, detail="No reset request found")
    expires = datetime.fromisoformat(record["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now_dt():
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Code expired")
    if record["otp"] != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid code")
    return {"ok": True}

@router.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordPayload):
    email = payload.email.lower()
    record = await db.password_resets.find_one({"email": email}, PROJECTION)
    if not record:
        raise HTTPException(status_code=400, detail="No reset request found")
    expires = datetime.fromisoformat(record["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now_dt():
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Code expired")
    if record["otp"] != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid code")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 chars")
    await db.users.update_one(
        {"email": email},
        {"$set": {"password_hash": hash_password(payload.new_password)}}
    )
    await db.password_resets.delete_many({"email": email})
    return {"ok": True}
