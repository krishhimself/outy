"""Outings: create, list, read, update, delete."""

import re
from datetime import date
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.access import require_member
from app.database import PROJECTION, db
from app.security import get_current_user
from app.utils import gen_code, now_dt, now_iso


router = APIRouter()

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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
    name: str = Field(max_length=80)
    destination: str = Field(max_length=120)
    description: Optional[str] = Field(default="", max_length=1000)
    cover_url: Optional[str] = Field(default=None, max_length=2000)
    start_date: str
    end_date: str


class OutingUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    destination: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    cover_url: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[str] = None
    end_date: Optional[str] = None


def _parse_date(value: str, label: str) -> date:
    if not DATE_RE.match(value):
        raise HTTPException(status_code=400, detail=f"{label} must look like 2026-01-31")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} is not a real date")


def _validate(name: str, destination: str, cover_url: Optional[str], start: str, end: str) -> None:
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    if not destination.strip():
        raise HTTPException(status_code=400, detail="Destination required")
    if cover_url and not cover_url.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="Cover photo must be a web link")
    if _parse_date(end, "End date") < _parse_date(start, "Start date"):
        raise HTTPException(status_code=400, detail="End date can't be before start date")


async def new_invite_code() -> str:
    """An invite code no other outing is using."""
    for _ in range(10):
        code = gen_code(6)
        if not await db.outings.find_one({"invite_code": code}, PROJECTION):
            return code
    return gen_code(10)


@router.post("/outings", response_model=Outing)
async def create_outing(payload: OutingCreate, current=Depends(get_current_user)):
    _validate(payload.name, payload.destination, payload.cover_url, payload.start_date, payload.end_date)
    outing = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "destination": payload.destination.strip(),
        "description": (payload.description or "").strip(),
        "cover_url": payload.cover_url or None,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "created_by": current["id"],
        "members": [{
            "user_id": current["id"],
            "name": current["name"],
            "avatar_url": current.get("avatar_url"),
        }],
        "invite_code": await new_invite_code(),
        "created_at": now_iso(),
    }
    await db.outings.insert_one(outing)
    return Outing(**outing)


@router.get("/outings", response_model=List[Outing])
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


@router.get("/outings/{outing_id}", response_model=Outing)
async def get_outing(outing_id: str, current=Depends(get_current_user)):
    return Outing(**await require_member(outing_id, current))


@router.put("/outings/{outing_id}", response_model=Outing)
async def update_outing(outing_id: str, payload: OutingUpdate, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current)
    if outing["created_by"] != current["id"]:
        raise HTTPException(status_code=403, detail="Only the outing's creator can edit it")
    update = {k: v for k, v in payload.dict().items() if v is not None}
    for field in ("name", "destination", "description"):
        if field in update:
            update[field] = update[field].strip()
    merged = {**outing, **update}
    _validate(merged["name"], merged["destination"], merged.get("cover_url"), merged["start_date"], merged["end_date"])
    if update:
        await db.outings.update_one({"id": outing_id}, {"$set": update})
    return Outing(**merged)


@router.delete("/outings/{outing_id}")
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
