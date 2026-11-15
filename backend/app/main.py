"""Outy API application.

Auth is email/password with bcrypt hashes and opaque session tokens stored in
MongoDB (plus Google sign-in). Every route lives under /api.
"""

import logging

import resend
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app.config import RESEND_API_KEY
from app.database import client, db
from app.routers import auth, chat, expenses, gallery, invites, outings, todos


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

resend.api_key = RESEND_API_KEY

app = FastAPI(title="Outy API")
api_router = APIRouter(prefix="/api")


MAX_BODY_BYTES = 12 * 1024 * 1024


@app.middleware("http")
async def reject_huge_requests(request: Request, call_next):
    """Refuse oversized uploads before reading them into memory."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "That upload is too large."})
    return await call_next(request)


@app.api_route("/health", methods=["GET", "HEAD"], include_in_schema=False)
async def health():
    """For uptime monitors. Answers HEAD as well as GET, because most monitors send HEAD."""
    return {"status": "ok"}


@api_router.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {"message": "Outy API up"}


for module in (auth, outings, invites, expenses, gallery, todos, chat):
    api_router.include_router(module.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,  # auth is a Bearer header, not a cookie
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)


@app.on_event("startup")
async def setup_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.password_resets.create_index("email")
    await db.outings.create_index("members.user_id")
    await db.outings.create_index("invite_code")
    await db.messages.create_index([("outing_id", 1), ("created_at", -1)])
    await db.expenses.create_index("outing_id")
    await db.gallery.create_index("outing_id")
    await db.todos.create_index("outing_id")
    await db.invites.create_index("invited_user_id")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
