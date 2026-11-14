"""Per-outing photo gallery."""

from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import PROJECTION, db
from app.security import (
    get_current_user,
)
from app.services import post_system_message
from app.utils import now_iso


router = APIRouter()


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


@router.post("/outings/{outing_id}/gallery", response_model=GalleryItem)
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
    await post_system_message(outing_id, f"{current['name']} added a new photo to the gallery")
    return item


@router.get("/outings/{outing_id}/gallery", response_model=List[GalleryItem])
async def list_gallery(outing_id: str, current=Depends(get_current_user)):
    docs = await db.gallery.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [GalleryItem(**d) for d in docs]


@router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str, current=Depends(get_current_user)):
    res = await db.gallery.delete_one({"id": item_id, "uploaded_by": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found or not yours")
    return {"ok": True}
