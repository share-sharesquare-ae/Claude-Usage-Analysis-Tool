import argparse
import asyncio
import getpass

from .auth import hash_password, is_organization_email, normalize_email
from .config import settings
from .store import PostgresStore


async def run(email: str, display_name: str | None) -> None:
    email = normalize_email(email)
    if not is_organization_email(email):
        raise SystemExit(f"Email must belong to @{settings.normalized_organization_domain}")
    password = getpass.getpass("Admin password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match")
    if len(password) < 12:
        raise SystemExit("Use at least 12 characters")
    store = PostgresStore(settings.database_url)
    await store.connect()
    try:
        await store.create_admin(email, hash_password(password), display_name)
    finally:
        await store.close()
    print(f"Admin access enabled for {email}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create or update an approved dashboard admin")
    parser.add_argument("email")
    parser.add_argument("--name", dest="display_name")
    args = parser.parse_args()
    asyncio.run(run(args.email, args.display_name))
