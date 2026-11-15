"""Test setup.

By default the tests start the API in-process against an in-memory database
(mongomock), so they never touch a real MongoDB and need no running server.
Set OUTY_API_URL to run the HTTP tests against a live server instead; the
in-process-only tests (rate limits, password reset) are skipped in that mode.
"""

import os
import re
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
IN_PROCESS = "OUTY_API_URL" not in os.environ

sent_emails: list = []

if IN_PROCESS:
    os.environ["MONGO_URL"] = "mongodb://in-memory"
    os.environ["DB_NAME"] = "outy_test"
    os.environ["RESEND_API_KEY"] = ""
    sys.path.insert(0, str(BACKEND_DIR))

    import motor.motor_asyncio as motor_asyncio
    from mongomock_motor import AsyncMongoMockClient

    motor_asyncio.AsyncIOMotorClient = AsyncMongoMockClient

    import resend
    import uvicorn

    resend.Emails.send = lambda params: sent_emails.append(params) or {"id": "test"}

    from app.main import app

    try:  # switched back on by the tests that exercise it
        from app import ratelimit
        ratelimit.limiter.enabled = False
    except ImportError:
        ratelimit = None

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    os.environ["OUTY_API_URL"] = f"http://127.0.0.1:{port}"
    os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"
    for _ in range(100):
        try:
            requests.get(f"http://127.0.0.1:{port}/api/", timeout=1)
            break
        except requests.RequestException:
            time.sleep(0.1)


@pytest.fixture
def in_process():
    """Skip a test that needs direct access to the app (not a remote server)."""
    if not IN_PROCESS:
        pytest.skip("needs the in-process test server")


@pytest.fixture
def rate_limits(in_process):
    """Turn the rate limiter on for one test, then reset it."""
    ratelimit.limiter.reset()
    ratelimit.limiter.enabled = True
    yield
    ratelimit.limiter.enabled = False
    ratelimit.limiter.reset()


@pytest.fixture
def outbox(in_process):
    """Emails 'sent' during the test. last_code() returns the newest 6-digit code."""
    sent_emails.clear()

    class Outbox:
        emails = sent_emails

        @staticmethod
        def last_code() -> str:
            assert sent_emails, "no email was sent"
            return re.search(r">\s*(\d{6})\s*<", sent_emails[-1]["html"]).group(1)

    return Outbox
