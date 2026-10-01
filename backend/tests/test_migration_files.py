from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_migrations_ignore_macos_appledouble_metadata(store, tmp_path, monkeypatch):
    metadata = tmp_path / '._001_schema.sql'
    metadata.write_bytes(b'\x00\xff\xa3not a SQL migration')
    original = Path.glob
    def with_metadata(path, pattern):
        files = list(original(path, pattern))
        return iter([metadata, *files]) if path.name == 'migrations' and pattern == '*.sql' else iter(files)
    monkeypatch.setattr(Path, 'glob', with_metadata)
    await store.migrate()
    rows = await store.query('SELECT version FROM schema_migrations')
    assert all(not row['version'].startswith('.') for row in rows)
