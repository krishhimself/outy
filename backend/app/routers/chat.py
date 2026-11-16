"""Per-outing crew chat (polled by the client)."""

from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.access import require_member
from app.database import PROJECTION, db
from app.security import get_current_user
from app.utils import now_iso


router = APIRouter()


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    sender_id: str
    sender_name: str
    sender_avatar: Optional[str] = None
    type: str = "text"  # text | system
    text: str
    created_at: str = Field(default_factory=now_iso)


MAX_MESSAGE_LENGTH = 2000


class MessageCreate(BaseModel):
    text: str = Field(max_length=MAX_MESSAGE_LENGTH)


@router.post("/outings/{outing_id}/messages", response_model=Message)
async def post_message(outing_id: str, payload: MessageCreate, current=Depends(get_current_user)):
    await require_member(outing_id, current)
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
    await db.messages.insert_one(msg.model_dump())
    return msg


@router.get("/outings/{outing_id}/messages", response_model=List[Message])
async def list_messages(outing_id: str, since: Optional[str] = None, limit: int = 200, current=Depends(get_current_user)):
    await require_member(outing_id, current)
    query: dict = {"outing_id": outing_id}
    if since:
        query["created_at"] = {"$gt": since}
    # Newest `limit` messages, returned oldest-first for display.
    limit = max(1, min(limit, 500))
    docs = await db.messages.find(query, PROJECTION).sort("created_at", -1).limit(limit).to_list(limit)
    docs.reverse()
    return [Message(**d) for d in docs]
