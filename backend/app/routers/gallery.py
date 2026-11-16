"""Per-outing photo gallery."""

import re
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.access import require_member
from app.database import PROJECTION, db
from app.security import get_current_user
from app.services import post_system_message
from app.utils import now_iso


router = APIRouter()

# MongoDB cannot store a document over 16 MB, so photos are capped well below it.
MAX_IMAGE_CHARS = 10_000_000  # about 7.5 MB of image data
IMAGE_DATA_URI = re.compile(r"^data:image/(jpeg|jpg|png|webp|gif|heic|heif);base64,")


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
    caption: Optional[str] = Field(default="", max_length=300)


@router.post("/outings/{outing_id}/gallery", response_model=GalleryItem)
async def add_gallery_item(outing_id: str, payload: GalleryCreate, current=Depends(get_current_user)):
    await require_member(outing_id, current)
    if not payload.image_b64:
        raise HTTPException(status_code=400, detail="image_b64 required")
    if len(payload.image_b64) > MAX_IMAGE_CHARS:
        raise HTTPException(status_code=413, detail="That photo is too large. Try a smaller one.")
    if not IMAGE_DATA_URI.match(payload.image_b64):
        raise HTTPException(status_code=400, detail="Only image files can be uploaded")
    item = GalleryItem(
        outing_id=outing_id,
        image_b64=payload.image_b64,
        uploaded_by=current["id"],
        uploaded_by_name=current["name"],
        caption=(payload.caption or "").strip(),
    )
    await db.gallery.insert_one(item.model_dump())
    await post_system_message(outing_id, f"{current['name']} added a new photo to the gallery")
    return item


@router.get("/outings/{outing_id}/gallery", response_model=List[GalleryItem])
async def list_gallery(outing_id: str, current=Depends(get_current_user)):
    await require_member(outing_id, current)
    docs = await db.gallery.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [GalleryItem(**d) for d in docs]


@router.get("/outings/{outing_id}/gallery/count")
async def gallery_count(outing_id: str, current=Depends(get_current_user)):
    """Number of photos, without downloading the photos themselves."""
    await require_member(outing_id, current)
    return {"count": await db.gallery.count_documents({"outing_id": outing_id})}


@router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str, current=Depends(get_current_user)):
    item = await db.gallery.find_one({"id": item_id}, {"_id": 0, "image_b64": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found or not yours")
    outing = await db.outings.find_one({"id": item["outing_id"]}, PROJECTION)
    is_owner = bool(outing) and outing["created_by"] == current["id"]
    if item["uploaded_by"] != current["id"] and not is_owner:
        raise HTTPException(status_code=404, detail="Item not found or not yours")
    await db.gallery.delete_one({"id": item_id})
    return {"ok": True}
