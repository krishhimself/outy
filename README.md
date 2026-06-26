# Outy

A full-stack mobile app for planning and reliving group trips — invites, group chat, expense splitting, shared to-do lists, and a per-trip photo gallery, all in one place.

## The Problem

Coordinating a group trip usually means juggling five different chat threads, splitting costs manually after the fact, and later digging through one giant camera roll to find photos from a specific outing. Outy keeps each trip as its own self-contained space — a "memory capsule" with its own chat, gallery, and to-do list — so nothing gets lost across trips.

## Tech Stack

- **Frontend:** React Native (Expo), TypeScript, Expo Router
- **Backend:** FastAPI (Python), async throughout
- **Database:** MongoDB Atlas, accessed via Motor (async driver)
- **Hosting:** Backend deployed on Render
- **Auth:** Custom email/password auth — bcrypt password hashing + database-backed session tokens (not JWT)

## Features

- **Outings** — create, edit, and manage trips with cover photos via Unsplash search
- **Invites** — invite by username (accept/reject) or via a shareable invite code
- **Group chat** — per-outing chat with auto-generated system messages (e.g. "X added a photo")
- **Expense splitting** — equal or custom splits, with a debt-settlement algorithm that minimizes the number of transactions needed to settle balances
- **Shared to-do lists** — per-outing, with optional assignment to crew members
- **Photo gallery** — per-outing gallery with pinch-to-zoom viewing

## Running Locally

**Backend:**
```bash
cd backend
# create a .env file with: MONGO_URL, DB_NAME, RESEND_API_KEY, SESSION_TTL_DAYS, INVITE_TTL_DAYS
uvicorn server:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npx expo start
# scan the QR code with Expo Go on your phone
```

## Known Limitations

- Chat is polling-based, not real-time (no WebSockets)
- No editing an expense after it's created
- Currency is hardcoded to INR
- Not yet published as a standalone app on the App Store / Play Store — runs via Expo Go

## Status

Backend is live on Render with a real MongoDB Atlas database. Frontend is functional and tested via Expo Go; not yet published to app stores.