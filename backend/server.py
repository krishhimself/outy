"""Entry point. Run with:  uvicorn server:app --reload --port 8000

The application itself lives in the `app` package.
"""

from app.main import app

__all__ = ["app"]
