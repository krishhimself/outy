"""Small shared helpers: timestamps and code generation."""

from datetime import datetime, timezone
import secrets
import string


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def gen_code(n: int = 6) -> str:
    """Random invite code. Uses `secrets` so codes cannot be predicted."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))
