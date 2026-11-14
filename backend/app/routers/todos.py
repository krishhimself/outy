"""Per-outing shared to-do list."""

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


@router.post("/outings/{outing_id}/todos", response_model=Todo)
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
    await post_system_message(outing_id, f"{current['name']} added “{todo.title}” to the to-do list{assignee}")
    return todo


@router.get("/outings/{outing_id}/todos", response_model=List[Todo])
async def list_todos(outing_id: str, current=Depends(get_current_user)):
    docs = await db.todos.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: (d.get("done", False), d.get("created_at", "")))
    return [Todo(**d) for d in docs]


@router.put("/todos/{todo_id}", response_model=Todo)
async def update_todo(todo_id: str, payload: TodoUpdate, current=Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if update:
        await db.todos.update_one({"id": todo_id}, {"$set": update})
    doc = await db.todos.find_one({"id": todo_id}, PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Todo not found")
    return Todo(**doc)


@router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str, current=Depends(get_current_user)):
    res = await db.todos.delete_one({"id": todo_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"ok": True}
