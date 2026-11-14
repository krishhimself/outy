"""MongoDB connection (Motor async driver)."""

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import DB_NAME, MONGO_URL


client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Passed to every query so Mongo's internal _id never leaks into API responses.
PROJECTION = {"_id": 0}
