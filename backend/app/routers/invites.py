"""Invites by username (accept/reject inbox) and instant join by code."""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import INVITE_TTL_DAYS
from app.access import is_member, require_member
from app.database import PROJECTION, db
from app.ratelimit import TOO_MANY, limiter
from app.security import get_current_user, normalize_username
from app.services import post_system_message
from app.utils import now_dt, now_iso
from app.routers.outings import Outing


router = APIRouter()


class InviteByUsernamePayload(BaseModel):
    username: str = Field(max_length=64)


class JoinByCodePayload(BaseModel):
    invite_code: str = Field(max_length=32)


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


@router.post("/outings/{outing_id}/invite", response_model=Invite)
async def invite_by_username(outing_id: str, payload: InviteByUsernamePayload, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current, detail="Only crew members can invite")
    limiter.check(f"invite:{current['id']}", limit=30, window=600)
    invited = await db.users.find_one({"username": normalize_username(payload.username)}, PROJECTION)
    if not invited:
        raise HTTPException(status_code=404, detail="No user with that username")
    if invited["id"] == current["id"]:
        raise HTTPException(status_code=400, detail="You're already in this outing")
    if is_member(outing, invited["id"]):
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


@router.get("/invites", response_model=List[Invite])
async def list_my_invites(current=Depends(get_current_user)):
    await _expire_invites(current["id"])
    docs = await db.invites.find(
        {"invited_user_id": current["id"], "status": "pending"}, PROJECTION,
    ).to_list(200)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [Invite(**d) for d in docs]


@router.post("/invites/{invite_id}/accept", response_model=Outing)
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
    if not is_member(outing, current["id"]):
        await db.outings.update_one(
            {"id": inv["outing_id"], "members.user_id": {"$ne": current["id"]}},
            {"$push": {"members": {"user_id": current["id"], "name": current["name"], "avatar_url": current.get("avatar_url")}}},
        )
        await post_system_message(inv["outing_id"], f"{current['name']} joined the crew")
    await db.invites.update_one({"id": invite_id}, {"$set": {"status": "accepted"}})
    fresh = await db.outings.find_one({"id": inv["outing_id"]}, PROJECTION)
    return Outing(**fresh)


@router.post("/invites/{invite_id}/reject")
async def reject_invite(invite_id: str, current=Depends(get_current_user)):
    inv = await db.invites.find_one({"id": invite_id}, PROJECTION)
    if not inv or inv["invited_user_id"] != current["id"]:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Invite already {inv['status']}")
    await db.invites.update_one({"id": invite_id}, {"$set": {"status": "rejected"}})
    return {"ok": True}


@router.post("/outings/join", response_model=Outing)
async def join_by_code(payload: JoinByCodePayload, current=Depends(get_current_user)):
    # Only wrong codes count toward the limit, so normal use is never slowed down.
    guess_key = f"join-miss:{current['id']}"
    if limiter.is_blocked(guess_key, limit=10, window=600):
        raise HTTPException(status_code=429, detail=TOO_MANY)
    code = payload.invite_code.strip().upper()
    outing = await db.outings.find_one({"invite_code": code}, PROJECTION) if code else None
    if not outing:
        limiter.record(guess_key)
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if not is_member(outing, current["id"]):
        await db.outings.update_one(
            {"id": outing["id"], "members.user_id": {"$ne": current["id"]}},
            {"$push": {"members": {"user_id": current["id"], "name": current["name"], "avatar_url": current.get("avatar_url")}}},
        )
        await post_system_message(outing["id"], f"{current['name']} joined the crew via invite code")
    updated = await db.outings.find_one({"id": outing["id"]}, PROJECTION)
    return Outing(**updated)
