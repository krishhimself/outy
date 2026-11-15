"""Shared side effects used by more than one router."""

import uuid


from app.database import db
from app.utils import now_iso


async def post_system_message(outing_id: str, text: str) -> None:
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
