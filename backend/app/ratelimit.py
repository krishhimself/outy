"""Simple in-memory rate limiting.

Good enough for a single server process (the Render free tier runs one). The
counters reset when the server restarts. Limits keyed on an account (email or
user id) are the real protection; limits keyed on IP address are a looser
second layer, because many people can share one IP (a hostel, a mobile network).
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

TOO_MANY = "Too many attempts. Please wait a few minutes and try again."


class RateLimiter:
    def __init__(self) -> None:
        self.enabled = True
        self._hits: dict = defaultdict(deque)
        self._lock = threading.Lock()

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)

    def _recent(self, key: str, window: float) -> deque:
        hits = self._hits[key]
        cutoff = time.monotonic() - window
        while hits and hits[0] < cutoff:
            hits.popleft()
        return hits

    def record(self, key: str) -> None:
        """Count one event against `key`."""
        with self._lock:
            if len(self._hits) > 20000:  # keep memory bounded
                self._hits.clear()
            self._hits[key].append(time.monotonic())

    def is_blocked(self, key: str, limit: int, window: float) -> bool:
        """True when `key` already has `limit` events inside the last `window` seconds."""
        if not self.enabled:
            return False
        with self._lock:
            return len(self._recent(key, window)) >= limit

    def check(self, key: str, limit: int, window: float) -> None:
        """Count one event and raise 429 once `key` goes over `limit` per `window` seconds."""
        if not self.enabled:
            return
        if self.is_blocked(key, limit, window):
            raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(int(window))})
        self.record(key)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    """Best-effort caller IP. Behind Render's proxy the address is in X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
