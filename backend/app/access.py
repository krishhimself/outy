"""Who is allowed to see or change an outing."""

from fastapi import HTTPException

from app.database import PROJECTION, db


def is_member(outing: dict, user_id: str) -> bool:
    return any(m["user_id"] == user_id for m in outing.get("members", []))


async def require_member(outing_id: str, user: dict, detail: str = "Not a crew member") -> dict:
    """Return the outing if `user` is in its crew; otherwise 404 (missing) or 403 (not in crew)."""
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not is_member(outing, user["id"]):
        raise HTTPException(status_code=403, detail=detail)
    return outing


def member_name(outing: dict, user_id: str) -> str | None:
    for m in outing.get("members", []):
        if m["user_id"] == user_id:
            return m["name"]
    return None
