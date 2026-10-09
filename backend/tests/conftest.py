import os
import uuid

import psycopg
import pytest_asyncio
from psycopg import sql

from coach.db import Store


@pytest_asyncio.fixture
async def store():
    url = os.getenv("TEST_DATABASE_URL", "postgresql://localhost:65431/postgres")
    schema = "test_" + uuid.uuid4().hex
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as c:
        await c.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    db = Store(url, options=f"-c search_path={schema}")
    await db.open()
    await db.migrate()
    try:
        yield db
    finally:
        await db.close()
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as c:
            await c.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
