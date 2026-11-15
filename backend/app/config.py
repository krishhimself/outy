"""Environment-driven settings. Values come from backend/.env locally and from
the host's environment variables (Render) in production."""

import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
INVITE_TTL_DAYS = int(os.environ.get("INVITE_TTL_DAYS", "7"))
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")

# Google sign-in goes through a third-party OAuth proxy (Emergent) and the app
# has no Google button yet, so the endpoint stays off unless this is "true".
GOOGLE_AUTH_ENABLED = os.environ.get("GOOGLE_AUTH_ENABLED", "").lower() == "true"
EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
