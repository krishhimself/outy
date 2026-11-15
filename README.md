# Outy

A mobile app for planning and reliving group trips. Each trip is its own space with a crew, a chat, shared expenses, a to-do list and a photo gallery.

## Why

Group trips usually end up spread across several chat threads, a spreadsheet for money, and one giant camera roll. Outy keeps everything for one trip in one place, so nothing from a trip gets lost among the others.

## Features

| Area | What it does |
| --- | --- |
| Outings | Create, edit and delete trips, with cover photos from Unsplash search |
| Invites | Invite by username (accept or reject from an inbox) or join with an invite code |
| Chat | Per-outing crew chat, with system messages when someone adds a photo or a to-do |
| Expenses | Equal or custom splits, balances, and a settlement plan that minimises the number of payments |
| To-dos | Shared per-outing list, with optional assignment to a crew member |
| Gallery | Per-outing photos with pinch-to-zoom |
| Accounts | Email and password sign-up, password reset by emailed code |

## Tech stack

| Layer | Technology |
| --- | --- |
| Mobile app | React Native (Expo SDK 54), TypeScript, Expo Router |
| API | FastAPI (Python 3.11), async throughout |
| Database | MongoDB Atlas, through the Motor async driver |
| Auth | bcrypt password hashes and opaque session tokens (stored hashed) in MongoDB |
| Email | Resend (password reset codes) |
| Hosting | Render (API) |

## Project structure

```
outy/
├── backend/
│   ├── server.py              Entry point (uvicorn server:app)
│   ├── app/
│   │   ├── main.py            App setup: CORS, routers, startup indexes
│   │   ├── config.py          Settings read from environment variables
│   │   ├── database.py        MongoDB connection
│   │   ├── security.py        Password hashing, sessions, auth dependency
│   │   ├── access.py          Crew-membership checks
│   │   ├── ratelimit.py       Limits on sign-in, reset-code and invite-code guessing
│   │   ├── services.py        Shared side effects (chat system messages)
│   │   ├── utils.py           Timestamps and code generation
│   │   └── routers/           One module per feature
│   │       ├── auth.py
│   │       ├── outings.py
│   │       ├── invites.py
│   │       ├── expenses.py
│   │       ├── gallery.py
│   │       ├── todos.py
│   │       └── chat.py
│   ├── tests/                 API tests (pytest)
│   ├── requirements.txt
│   ├── requirements-dev.txt   Extra packages for running the tests
│   └── runtime.txt            Python version for Render
├── frontend/
│   ├── app/                   Screens (file-based routes)
│   │   ├── (tabs)/            Home, create, expenses, memories, profile
│   │   ├── auth/              Sign in, sign up, password reset
│   │   └── outing/            Outing detail, chat, expenses, gallery, to-dos
│   ├── src/
│   │   ├── api/               Typed API client
│   │   ├── components/        Shared UI components
│   │   ├── hooks/
│   │   ├── state/             Auth context
│   │   ├── theme/             Colours, spacing, radii
│   │   └── utils/             Storage and font helpers
│   ├── assets/                Icons, splash, fonts
│   └── app.json               Expo configuration
├── docs/
│   ├── design-guidelines.json Design tokens and UI guidelines
│   └── security-review.md     What the security review found and fixed
├── start-backend.ps1
└── start-frontend.ps1
```

## Running locally

You need Python 3.11 or newer, Node.js 20 or newer, and the Expo Go app on your phone.

### 1. Backend

One-time setup:

```powershell
cd backend
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
```

Fill in `backend\.env` (see [Environment variables](#environment-variables)), then from the repo root:

```powershell
.\start-backend.ps1
```

The API runs at `http://localhost:8000/api`.

### 2. Frontend

One-time setup:

```powershell
cd frontend
npm install
copy .env.example .env
```

Then from the repo root:

```powershell
.\start-frontend.ps1            # normal
.\start-frontend.ps1 -Tunnel    # when your phone is not on the same Wi-Fi
.\start-frontend.ps1 -Clear     # clear the Metro cache first
```

Scan the QR code with Expo Go, or press `w` for the web version.

## Environment variables

`backend/.env`

| Name | Required | Purpose |
| --- | --- | --- |
| `MONGO_URL` | Yes | MongoDB connection string |
| `DB_NAME` | Yes | Database name |
| `RESEND_API_KEY` | For password reset | Resend API key |
| `SESSION_TTL_DAYS` | No (default 30) | How long a sign-in lasts |
| `INVITE_TTL_DAYS` | No (default 7) | How long an invite stays pending |
| `GOOGLE_AUTH_ENABLED` | No (default off) | Set to `true` to turn the Google sign-in endpoint on |

`frontend/.env`

| Name | Required | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_BACKEND_URL` | Yes | API base URL, without `/api` |
| `EXPO_PUBLIC_UNSPLASH_KEY` | For cover search | Unsplash access key |

Never commit a `.env` file. Both are ignored by git.

## Tests

The API tests start the server themselves on an in-memory database, so they need no running backend and never touch your real data:

```powershell
cd backend
venv\Scripts\python.exe -m pip install -r requirements-dev.txt
venv\Scripts\python.exe -m pytest tests
```

`tests/test_security.py` plays an attacker (a signed-in user outside the crew, a password-reset code guesser, and so on) and checks the API refuses.

Frontend checks:

```powershell
cd frontend
npm run typecheck
npm run lint
```

## Deployment

The API is deployed on Render from the `backend` folder.

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Environment variables: the same names as `backend/.env`
- Uptime monitor URL: `https://<your-service>.onrender.com/health` (answers both GET and HEAD)

## Known limitations

- Chat polls every two seconds; it does not use WebSockets
- Gallery photos are stored as base64 in MongoDB
- Expenses cannot be edited after creation
- Currency is fixed to INR
- Password reset emails only reach the Resend account owner until a sending domain is verified
- Not yet published to the App Store or Play Store; it runs through Expo Go
