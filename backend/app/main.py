"""Outy API application.

Auth is email/password with bcrypt hashes and opaque session tokens stored in
MongoDB (plus Google sign-in). Every route lives under /api.
"""

import logging

import resend
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.config import RESEND_API_KEY
from app.database import client, db
from app.routers import auth, chat, expenses, gallery, invites, outings, todos


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

resend.api_key = RESEND_API_KEY

app = FastAPI(title="Outy API")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Outy API up"}


for module in (auth, outings, invites, expenses, gallery, todos, chat):
    api_router.include_router(module.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
