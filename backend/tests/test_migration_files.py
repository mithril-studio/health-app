from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_migrations_ignore_macos_appledouble_metadata(store, tmp_path, monkeypatch):
    metadata = tmp_path / "._001_schema.sql"
    metadata.write_bytes(b"\x00\xff\xa3not a SQL migration")
    original = Path.glob

    def with_metadata(path, pattern):
        files = list(original(path, pattern))
        return (
            iter([metadata, *files])
            if path.name == "migrations" and pattern == "*.sql"
            else iter(files)
        )

    monkeypatch.setattr(Path, "glob", with_metadata)
    await store.migrate()
    rows = await store.query("SELECT version FROM schema_migrations")
    assert all(not row["version"].startswith(".") for row in rows)


async def test_migration_009_removes_telegram_state(store):
    # Rebuild the pre-009 shape the one-way migration must clean up, then re-run it.
    await store.execute("CREATE TABLE IF NOT EXISTS telegram_link (id integer PRIMARY KEY)")
    await store.execute(
        "CREATE TABLE IF NOT EXISTS notification_parts "
        "(work_key text REFERENCES work_items(key), part integer, PRIMARY KEY(work_key,part))"
    )
    for key, kind in (
        ("telegram:1", "telegram"),
        ("echo:1", "notification"),
        ("job:morning:x", "job"),
        ("write:1", "write"),
    ):
        await store.enqueue(key, kind, {})
    await store.execute("INSERT INTO notification_parts(work_key,part) VALUES ('echo:1',0)")
    sql = (Path(__file__).parent.parent / "migrations" / "009_remove_telegram.sql").read_text()
    async with store.pool.connection() as conn:
        await conn.execute(sql)  # no params: the simple protocol runs every statement
    assert (await store.query("SELECT to_regclass('telegram_link') AS t", one=True))["t"] is None
    assert (
        await store.query("SELECT to_regclass('notification_parts') AS t", one=True)
    )["t"] is None
    kinds = sorted(r["kind"] for r in await store.query("SELECT DISTINCT kind FROM work_items"))
    assert kinds == ["job", "write"]
