"""Outy backend.

Auth: custom JWT (email/password) AND Emergent-managed Google sign-in.
Unified `get_current_user` dependency works for tokens from both flows.
Invites use an accept/reject inbox; instant-join via invite code stays.
Each outing has a chat with text messages and server-generated system
messages when a photo or todo is added.
"""

from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import re
import secrets
import string
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import httpx
import resend


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
INVITE_TTL_DAYS = int(os.environ.get("INVITE_TTL_DAYS", "7"))
EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
resend.api_key = os.environ.get("RESEND_API_KEY", "")

app = FastAPI()
api_router = APIRouter(prefix="/api")
PROJECTION = {"_id": 0}


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def gen_code(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


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


async def create_session(user_id: str, ext_token: Optional[str] = None) -> str:
    token = ext_token or secrets.token_urlsafe(32)
    expires = (now_dt() + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_iso(),
        "expires_at": expires,
    })
    return token


# ---------- Models ----------
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


# ---------- Auth dependency ----------
async def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[7:].strip()
    session = await db.user_sessions.find_one({"session_token": token}, PROJECTION)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    try:
        expires = datetime.fromisoformat(session["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session")
    if expires < now_dt():
        await db.user_sessions.delete_one({"session_token": token})
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"id": session["user_id"]}, PROJECTION)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user.pop("_id", None)  # belt + braces (projection already excludes it)
    return user


# ---------- Startup: indexes ----------
@app.on_event("startup")
async def setup_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.password_resets.create_index("email")


# ---------- Auth endpoints ----------
@api_router.get("/")
async def root():
    return {"message": "Outy API up"}


@api_router.post("/auth/signup")
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


@api_router.post("/auth/signin")
async def signin(payload: SigninPayload):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email}, PROJECTION)
    if not user or user.get("auth_provider") != "password":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = await create_session(user["id"])
    return {"token": token, "user": public_user(user), "needs_username": False}


@api_router.post("/auth/google/session")
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


@api_router.post("/auth/username")
async def claim_username(payload: ClaimUsernamePayload, current=Depends(get_current_user)):
    new_username = normalize_username(payload.username)
    await ensure_unique_username(new_username, allow_user_id=current["id"])
    await db.users.update_one({"id": current["id"]}, {"$set": {"username": new_username}})
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@api_router.get("/auth/me")
async def auth_me(current=Depends(get_current_user)):
    return {"user": public_user(dict(current))}


@api_router.put("/auth/me")
async def update_me(payload: UpdateProfilePayload, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None and v != ""}
    if update:
        await db.users.update_one({"id": current["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": current["id"]}, PROJECTION)
    return {"user": public_user(fresh)}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": authorization[7:].strip()})
    return {"ok": True}


# ---------- Outings ----------
class Member(BaseModel):
    user_id: str
    name: str
    avatar_url: Optional[str] = None


class Outing(BaseModel):
    id: str
    name: str
    destination: str
    description: Optional[str] = ""
    cover_url: Optional[str] = None
    start_date: str
    end_date: str
    created_by: str
    members: List[Member]
    invite_code: str
    created_at: str


class OutingCreate(BaseModel):
    name: str
    destination: str
    description: Optional[str] = ""
    cover_url: Optional[str] = None
    start_date: str
    end_date: str


class OutingUpdate(BaseModel):
    name: Optional[str] = None
    destination: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


@api_router.post("/outings", response_model=Outing)
async def create_outing(payload: OutingCreate, current=Depends(get_current_user)):
    outing = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "destination": payload.destination,
        "description": payload.description or "",
        "cover_url": payload.cover_url,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "created_by": current["id"],
        "members": [{
            "user_id": current["id"],
            "name": current["name"],
            "avatar_url": current.get("avatar_url"),
        }],
        "invite_code": gen_code(6),
        "created_at": now_iso(),
    }
    await db.outings.insert_one(outing)
    return Outing(**outing)


@api_router.get("/outings", response_model=List[Outing])
async def list_outings(scope: str = "all", current=Depends(get_current_user)):
    docs = await db.outings.find({"members.user_id": current["id"]}, PROJECTION).to_list(1000)
    outings = [Outing(**d) for d in docs]
    today = now_dt().date().isoformat()
    if scope == "upcoming":
        outings = [o for o in outings if o.end_date >= today]
    elif scope == "past":
        outings = [o for o in outings if o.end_date < today]
    outings.sort(key=lambda o: o.start_date)
    return outings


@api_router.get("/outings/{outing_id}", response_model=Outing)
async def get_outing(outing_id: str, current=Depends(get_current_user)):
    doc = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Outing not found")
    return Outing(**doc)


@api_router.put("/outings/{outing_id}", response_model=Outing)
async def update_outing(outing_id: str, payload: OutingUpdate, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if update:
        await db.outings.update_one({"id": outing_id}, {"$set": update})
    doc = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Outing not found")
    return Outing(**doc)


@api_router.delete("/outings/{outing_id}")
async def delete_outing(outing_id: str, current=Depends(get_current_user)):
    res = await db.outings.delete_one({"id": outing_id, "created_by": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Outing not found or not yours")
    await db.expenses.delete_many({"outing_id": outing_id})
    await db.gallery.delete_many({"outing_id": outing_id})
    await db.todos.delete_many({"outing_id": outing_id})
    await db.messages.delete_many({"outing_id": outing_id})
    await db.invites.delete_many({"outing_id": outing_id})
    return {"ok": True}


# ---------- Invite system ----------
class InviteByUsernamePayload(BaseModel):
    username: str


class JoinByCodePayload(BaseModel):
    invite_code: str


class Invite(BaseModel):
    id: str
    outing_id: str
    outing_name: str
    outing_destination: str
    outing_cover_url: Optional[str] = None
    invited_user_id: str
    invited_username: str
    invited_by_user_id: str
    invited_by_name: str
    status: str  # pending | accepted | rejected | expired
    created_at: str
    expires_at: str


async def _expire_invites(user_id: str) -> None:
    now = now_dt()
    await db.invites.update_many(
        {"invited_user_id": user_id, "status": "pending", "expires_at": {"$lt": now.isoformat()}},
        {"$set": {"status": "expired"}},
    )


async def _post_system_message(outing_id: str, text: str) -> None:
    msg = {
        "id": str(uuid.uuid4()),
        "outing_id": outing_id,
        "sender_id": "system",
        "sender_name": "Outy",
        "sender_avatar": None,
        "type": "system",
        "text": text,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(msg)


@api_router.post("/outings/{outing_id}/invite", response_model=Invite)
async def invite_by_username(outing_id: str, payload: InviteByUsernamePayload, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Only crew members can invite")
    invited = await db.users.find_one({"username": normalize_username(payload.username)}, PROJECTION)
    if not invited:
        raise HTTPException(status_code=404, detail="No user with that username")
    if invited["id"] == current["id"]:
        raise HTTPException(status_code=400, detail="You're already in this outing")
    if any(m["user_id"] == invited["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=409, detail=f"{invited['name']} is already a crew member")
    # check for an existing pending invite
    existing = await db.invites.find_one({
        "outing_id": outing_id, "invited_user_id": invited["id"], "status": "pending",
    }, PROJECTION)
    if existing:
        return Invite(**existing)
    inv = {
        "id": str(uuid.uuid4()),
        "outing_id": outing_id,
        "outing_name": outing["name"],
        "outing_destination": outing["destination"],
        "outing_cover_url": outing.get("cover_url"),
        "invited_user_id": invited["id"],
        "invited_username": invited["username"],
        "invited_by_user_id": current["id"],
        "invited_by_name": current["name"],
        "status": "pending",
        "created_at": now_iso(),
        "expires_at": (now_dt() + timedelta(days=INVITE_TTL_DAYS)).isoformat(),
    }
    await db.invites.insert_one(inv)
    return Invite(**inv)


@api_router.get("/invites", response_model=List[Invite])
async def list_my_invites(current=Depends(get_current_user)):
    await _expire_invites(current["id"])
    docs = await db.invites.find(
        {"invited_user_id": current["id"], "status": "pending"}, PROJECTION,
    ).to_list(200)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [Invite(**d) for d in docs]


@api_router.post("/invites/{invite_id}/accept", response_model=Outing)
async def accept_invite(invite_id: str, current=Depends(get_current_user)):
    inv = await db.invites.find_one({"id": invite_id}, PROJECTION)
    if not inv or inv["invited_user_id"] != current["id"]:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Invite already {inv['status']}")
    expires = datetime.fromisoformat(inv["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now_dt():
        await db.invites.update_one({"id": invite_id}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="Invite expired")
    outing = await db.outings.find_one({"id": inv["outing_id"]}, PROJECTION)
    if not outing:
        await db.invites.delete_one({"id": invite_id})
        raise HTTPException(status_code=404, detail="Outing no longer exists")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        await db.outings.update_one(
            {"id": inv["outing_id"]},
            {"$push": {"members": {"user_id": current["id"], "name": current["name"], "avatar_url": current.get("avatar_url")}}},
        )
        await _post_system_message(inv["outing_id"], f"{current['name']} joined the crew")
    await db.invites.update_one({"id": invite_id}, {"$set": {"status": "accepted"}})
    fresh = await db.outings.find_one({"id": inv["outing_id"]}, PROJECTION)
    return Outing(**fresh)


@api_router.post("/invites/{invite_id}/reject")
async def reject_invite(invite_id: str, current=Depends(get_current_user)):
    inv = await db.invites.find_one({"id": invite_id}, PROJECTION)
    if not inv or inv["invited_user_id"] != current["id"]:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Invite already {inv['status']}")
    await db.invites.update_one({"id": invite_id}, {"$set": {"status": "rejected"}})
    return {"ok": True}


@api_router.post("/outings/join", response_model=Outing)
async def join_by_code(payload: JoinByCodePayload, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"invite_code": payload.invite_code.upper()}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        await db.outings.update_one(
            {"id": outing["id"]},
            {"$push": {"members": {"user_id": current["id"], "name": current["name"], "avatar_url": current.get("avatar_url")}}},
        )
        await _post_system_message(outing["id"], f"{current['name']} joined the crew via invite code")
    updated = await db.outings.find_one({"id": outing["id"]}, PROJECTION)
    return Outing(**updated)


# ---------- Expenses ----------
class ExpenseShare(BaseModel):
    user_id: str
    name: str
    share_amount: float


class Expense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    title: str
    amount: float
    category: str = "other"
    paid_by: str
    paid_by_name: str
    split_type: str = "equal"
    shares: List[ExpenseShare] = []
    created_at: str = Field(default_factory=now_iso)


class ExpenseCreate(BaseModel):
    title: str
    amount: float
    category: str = "other"
    paid_by: str
    paid_by_name: str
    split_type: str = "equal"
    shares: List[ExpenseShare] = []


@api_router.post("/outings/{outing_id}/expenses", response_model=Expense)
async def add_expense(outing_id: str, payload: ExpenseCreate, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    if not payload.shares:
        raise HTTPException(status_code=400, detail="At least one participant required")
    member_ids = {m["user_id"] for m in outing.get("members", [])}
    for s in payload.shares:
        if s.user_id not in member_ids:
            raise HTTPException(status_code=400, detail=f"Participant {s.name} is not a crew member")
    total = sum(s.share_amount for s in payload.shares)
    if abs(total - payload.amount) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Shares total {total:.2f} must equal expense amount {payload.amount:.2f}",
        )
    expense = Expense(outing_id=outing_id, **payload.dict())
    await db.expenses.insert_one(expense.dict())
    return expense


def _compute_balances(expenses, members):
    name_map = {m["user_id"]: m["name"] for m in members}
    paid: dict = {m["user_id"]: 0.0 for m in members}
    owed: dict = {m["user_id"]: 0.0 for m in members}
    for e in expenses:
        paid[e["paid_by"]] = paid.get(e["paid_by"], 0.0) + float(e["amount"])
        for s in e.get("shares", []):
            owed[s["user_id"]] = owed.get(s["user_id"], 0.0) + float(s["share_amount"])
    rows = []
    for uid in {**paid, **owed}:
        rows.append({
            "user_id": uid,
            "name": name_map.get(uid, "Unknown"),
            "total_paid": round(paid.get(uid, 0.0), 2),
            "total_owed": round(owed.get(uid, 0.0), 2),
            "net_balance": round(paid.get(uid, 0.0) - owed.get(uid, 0.0), 2),
        })
    rows.sort(key=lambda r: r["net_balance"], reverse=True)
    return rows


def _optimize_settlements(balances):
    creditors = [{"user_id": b["user_id"], "name": b["name"], "amount": b["net_balance"]}
                 for b in balances if b["net_balance"] > 0.01]
    debtors = [{"user_id": b["user_id"], "name": b["name"], "amount": -b["net_balance"]}
               for b in balances if b["net_balance"] < -0.01]
    creditors.sort(key=lambda x: x["amount"], reverse=True)
    debtors.sort(key=lambda x: x["amount"], reverse=True)
    txs = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        pay = round(min(debtors[i]["amount"], creditors[j]["amount"]), 2)
        if pay > 0.01:
            txs.append({
                "from_user_id": debtors[i]["user_id"], "from_name": debtors[i]["name"],
                "to_user_id": creditors[j]["user_id"], "to_name": creditors[j]["name"],
                "amount": pay,
            })
        debtors[i]["amount"] = round(debtors[i]["amount"] - pay, 2)
        creditors[j]["amount"] = round(creditors[j]["amount"] - pay, 2)
        if debtors[i]["amount"] <= 0.01:
            i += 1
        if creditors[j]["amount"] <= 0.01:
            j += 1
    return txs


@api_router.get("/outings/{outing_id}/expenses", response_model=List[Expense])
async def list_outing_expenses(outing_id: str, current=Depends(get_current_user)):
    docs = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [Expense(**d) for d in docs]


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current=Depends(get_current_user)):
    res = await db.expenses.delete_one({"id": expense_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}


@api_router.get("/outings/{outing_id}/balances")
async def outing_balances(outing_id: str, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    expenses = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    balances = _compute_balances(expenses, outing.get("members", []))
    total = round(sum(float(e["amount"]) for e in expenses), 2)
    return {"total": total, "balances": balances}


@api_router.get("/outings/{outing_id}/settlements")
async def outing_settlements(outing_id: str, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    expenses = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    balances = _compute_balances(expenses, outing.get("members", []))
    return {"balances": balances, "transactions": _optimize_settlements(balances)}


@api_router.get("/expenses/summary")
async def expenses_summary(current=Depends(get_current_user)):
    outings = await db.outings.find({"members.user_id": current["id"]}, PROJECTION).to_list(1000)
    outing_ids = [o["id"] for o in outings]
    if not outing_ids:
        return {"total": 0, "by_outing": [], "recent": []}
    expenses = await db.expenses.find({"outing_id": {"$in": outing_ids}}, PROJECTION).to_list(2000)
    total = round(sum(float(e["amount"]) for e in expenses), 2)
    name_map = {o["id"]: o["name"] for o in outings}
    by_outing_map: dict = {}
    for e in expenses:
        by_outing_map[e["outing_id"]] = by_outing_map.get(e["outing_id"], 0.0) + float(e["amount"])
    by_outing = [{"outing_id": k, "outing_name": name_map.get(k, ""), "total": round(v, 2)}
                 for k, v in by_outing_map.items()]
    by_outing.sort(key=lambda x: x["total"], reverse=True)
    expenses.sort(key=lambda e: e.get("created_at", ""), reverse=True)
    recent = []
    for e in expenses[:20]:
        recent.append({**{k: v for k, v in e.items() if k != "_id"}, "outing_name": name_map.get(e["outing_id"], "")})
    return {"total": total, "by_outing": by_outing, "recent": recent}


# ---------- Gallery ----------
class GalleryItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    image_b64: str
    uploaded_by: str
    uploaded_by_name: str
    caption: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)


class GalleryCreate(BaseModel):
    image_b64: str
    caption: Optional[str] = ""


@api_router.post("/outings/{outing_id}/gallery", response_model=GalleryItem)
async def add_gallery_item(outing_id: str, payload: GalleryCreate, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    if not payload.image_b64:
        raise HTTPException(status_code=400, detail="image_b64 required")
    item = GalleryItem(
        outing_id=outing_id,
        image_b64=payload.image_b64,
        uploaded_by=current["id"],
        uploaded_by_name=current["name"],
        caption=payload.caption or "",
    )
    await db.gallery.insert_one(item.dict())
    await _post_system_message(outing_id, f"{current['name']} added a new photo to the gallery 📸")
    return item


@api_router.get("/outings/{outing_id}/gallery", response_model=List[GalleryItem])
async def list_gallery(outing_id: str, current=Depends(get_current_user)):
    docs = await db.gallery.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [GalleryItem(**d) for d in docs]


@api_router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str, current=Depends(get_current_user)):
    res = await db.gallery.delete_one({"id": item_id, "uploaded_by": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found or not yours")
    return {"ok": True}


# ---------- To-dos ----------
class Todo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    title: str
    done: bool = False
    created_by: str
    created_by_name: str
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class TodoCreate(BaseModel):
    title: str
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None


@api_router.post("/outings/{outing_id}/todos", response_model=Todo)
async def add_todo(outing_id: str, payload: TodoCreate, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title required")
    todo = Todo(
        outing_id=outing_id,
        title=payload.title.strip(),
        created_by=current["id"],
        created_by_name=current["name"],
        assigned_to=payload.assigned_to,
        assigned_to_name=payload.assigned_to_name,
    )
    await db.todos.insert_one(todo.dict())
    assignee = f" for {payload.assigned_to_name}" if payload.assigned_to_name else ""
    await _post_system_message(outing_id, f"{current['name']} added “{todo.title}” to the to-do list{assignee} ✅")
    return todo


@api_router.get("/outings/{outing_id}/todos", response_model=List[Todo])
async def list_todos(outing_id: str, current=Depends(get_current_user)):
    docs = await db.todos.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: (d.get("done", False), d.get("created_at", "")))
    return [Todo(**d) for d in docs]


@api_router.put("/todos/{todo_id}", response_model=Todo)
async def update_todo(todo_id: str, payload: TodoUpdate, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if update:
        await db.todos.update_one({"id": todo_id}, {"$set": update})
    doc = await db.todos.find_one({"id": todo_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Todo not found")
    return Todo(**doc)


@api_router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str, current=Depends(get_current_user)):
    res = await db.todos.delete_one({"id": todo_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"ok": True}


# ---------- Chat ----------
class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    sender_id: str
    sender_name: str
    sender_avatar: Optional[str] = None
    type: str = "text"  # text | system
    text: str
    created_at: str = Field(default_factory=now_iso)


class MessageCreate(BaseModel):
    text: str


@api_router.post("/outings/{outing_id}/messages", response_model=Message)
async def post_message(outing_id: str, payload: MessageCreate, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    msg = Message(
        outing_id=outing_id,
        sender_id=current["id"],
        sender_name=current["name"],
        sender_avatar=current.get("avatar_url"),
        type="text",
        text=text,
    )
    await db.messages.insert_one(msg.dict())
    return msg


@api_router.get("/outings/{outing_id}/messages", response_model=List[Message])
async def list_messages(outing_id: str, since: Optional[str] = None, limit: int = 200, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    query: dict = {"outing_id": outing_id}
    if since:
        query["created_at"] = {"$gt": since}
    docs = await db.messages.find(query, PROJECTION).to_list(limit)
    docs.sort(key=lambda d: d.get("created_at", ""))
    return [Message(**d) for d in docs]


# ---------- Password Reset ----------
class ForgotPasswordPayload(BaseModel):
    email: EmailStr

class VerifyOTPPayload(BaseModel):
    email: EmailStr
    otp: str

class ResetPasswordPayload(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

@api_router.post("/auth/forgot-password")
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

@api_router.post("/auth/verify-otp")
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

@api_router.post("/auth/reset-password")
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

# ---------- App wiring ----------

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()