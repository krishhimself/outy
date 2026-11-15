"""Per-outing shared to-do list."""

from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.access import member_name, require_member
from app.database import PROJECTION, db
from app.security import get_current_user
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
    title: str = Field(max_length=200)
    assigned_to: Optional[str] = Field(default=None, max_length=64)
    assigned_to_name: Optional[str] = Field(default=None, max_length=200)


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    done: Optional[bool] = None
    assigned_to: Optional[str] = Field(default=None, max_length=64)
    assigned_to_name: Optional[str] = Field(default=None, max_length=200)


def _assignee_name(outing: dict, user_id: Optional[str]) -> Optional[str]:
    """The assignee's name from the crew list, or 400 if they are not in the crew."""
    if not user_id:
        return None
    name = member_name(outing, user_id)
    if name is None:
        raise HTTPException(status_code=400, detail="You can only assign a to-do to a crew member")
    return name


async def _todo_for_member(todo_id: str, user: dict) -> tuple:
    todo = await db.todos.find_one({"id": todo_id}, PROJECTION)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo, await require_member(todo["outing_id"], user)


@router.post("/outings/{outing_id}/todos", response_model=Todo)
async def add_todo(outing_id: str, payload: TodoCreate, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title required")
    assignee_name = _assignee_name(outing, payload.assigned_to)
    todo = Todo(
        outing_id=outing_id,
        title=payload.title.strip(),
        created_by=current["id"],
        created_by_name=current["name"],
        assigned_to=payload.assigned_to or None,
        assigned_to_name=assignee_name,
    )
    await db.todos.insert_one(todo.dict())
    assignee = f" for {assignee_name}" if assignee_name else ""
    await post_system_message(outing_id, f"{current['name']} added \u201c{todo.title}\u201d to the to-do list{assignee}")
    return todo


@router.get("/outings/{outing_id}/todos", response_model=List[Todo])
async def list_todos(outing_id: str, current=Depends(get_current_user)):
    await require_member(outing_id, current)
    docs = await db.todos.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: (d.get("done", False), d.get("created_at", "")))
    return [Todo(**d) for d in docs]


@router.put("/todos/{todo_id}", response_model=Todo)
async def update_todo(todo_id: str, payload: TodoUpdate, current=Depends(get_current_user)):
    todo, outing = await _todo_for_member(todo_id, current)
    update: dict = {}
    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=400, detail="title required")
        update["title"] = payload.title.strip()
    if payload.done is not None:
        update["done"] = payload.done
    if payload.assigned_to is not None:
        update["assigned_to"] = payload.assigned_to or None
        update["assigned_to_name"] = _assignee_name(outing, payload.assigned_to)
    if update:
        await db.todos.update_one({"id": todo_id}, {"$set": update})
    return Todo(**{**todo, **update})


@router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str, current=Depends(get_current_user)):
    await _todo_for_member(todo_id, current)
    await db.todos.delete_one({"id": todo_id})
    return {"ok": True}
