import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(MONGODB_URL)
db = client.ocean_visualizer

# Collections
products_collection = db.products
members_collection = db.members
