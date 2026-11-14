"""Outings: create, list, read, update, delete."""

from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import PROJECTION, db
from app.security import (
    get_current_user,
)
from app.utils import gen_code, now_dt, now_iso


router = APIRouter()


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


@router.post("/outings", response_model=Outing)
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
    doc = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Outing not found")
    return Outing(**doc)


@router.put("/outings/{outing_id}", response_model=Outing)
async def update_outing(outing_id: str, payload: OutingUpdate, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if update:
        await db.outings.update_one({"id": outing_id}, {"$set": update})
    doc = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Outing not found")
    return Outing(**doc)


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
