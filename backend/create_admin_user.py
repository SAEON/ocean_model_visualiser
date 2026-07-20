#!/usr/bin/env python3
import asyncio
import getpass
import sys
import os
from datetime import datetime

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.database import users_collection
from backend.main import get_password_hash


async def create_user():
    print("\n==========================================")
    print("🔐 SOMISANA Admin User Management")
    print("==========================================\n")

    try:
        username = input("Enter admin username: ").strip()
        if not username:
            print("❌ Error: Username cannot be empty.")
            sys.exit(1)

        password = getpass.getpass("Enter admin password: ")
        if not password:
            print("❌ Error: Password cannot be empty.")
            sys.exit(1)

        password_confirm = getpass.getpass("Confirm admin password: ")
        if password != password_confirm:
            print("❌ Error: Passwords do not match.")
            sys.exit(1)

        hashed = get_password_hash(password)
        existing_user = await users_collection.find_one({"username": username})

        if existing_user:
            confirm_update = (
                input(
                    f"⚠️ User '{username}' already exists. Update password? [y/N]: "
                )
                .strip()
                .lower()
            )
            if confirm_update == "y":
                await users_collection.update_one(
                    {"username": username},
                    {
                        "$set": {
                            "hashed_password": hashed,
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )
                print(
                    f"\n✅ Password successfully updated for user '{username}'."
                )
            else:
                print("\nOperation canceled.")
        else:
            await users_collection.insert_one(
                {
                    "username": username,
                    "hashed_password": hashed,
                    "role": "admin",
                    "created_at": datetime.utcnow(),
                }
            )
            print(
                f"\n✅ Admin user '{username}' successfully created!"
            )

    except KeyboardInterrupt:
        print("\n\nOperation canceled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error creating user: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(create_user())
