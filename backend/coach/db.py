import hashlib
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

DATED = frozenset({'activities', 'events', 'wellness', 'fitness_daily'})
CACHED = frozenset({'sport_settings', 'activity_intervals', 'activity_streams', 'curve_cache'})


def lock_id(key):
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], 'big', signed=True)


class Store:
    def __init__(self, url, **kwargs):
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=12, open=False,
                                       kwargs={'autocommit': True, 'row_factory': dict_row, 'client_encoding': 'utf8', **kwargs})

    async def open(self):
        await self.pool.open(wait=True, timeout=15)

    async def close(self):
        await self.pool.close()

    async def migrate(self):
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute('SELECT pg_advisory_xact_lock(%s)', (lock_id('migrations'),))
            await conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)')
            for path in sorted((Path(__file__).parent.parent / 'migrations').glob('*.sql')):
                if path.name.startswith('.'):
                    continue  # macOS archive metadata is not a database migration.
                if not await (await conn.execute('SELECT 1 FROM schema_migrations WHERE version=%s', (path.name,))).fetchone():
                    await conn.execute(path.read_text())
                    await conn.execute('INSERT INTO schema_migrations VALUES (%s)', (path.name,))

    @asynccontextmanager
    async def lock(self, key, wait=False):
        """Session advisory lock survives commits and vanishes on connection/process death."""
        async with self.pool.connection() as conn:
            if wait:
                await conn.execute('SELECT pg_advisory_lock(%s)', (lock_id(key),))
                acquired = True
            else:
                row = await (await conn.execute('SELECT pg_try_advisory_lock(%s) AS ok', (lock_id(key),))).fetchone()
                acquired = row['ok']
            try:
                yield conn if acquired else None
            finally:
                if acquired:
                    await conn.execute('SELECT pg_advisory_unlock(%s)', (lock_id(key),))

    async def query(self, query, params=(), *, conn=None, one=False):
        if conn:
            cur = await conn.execute(query, params)
            return await cur.fetchone() if one else await cur.fetchall()
        async with self.pool.connection() as c:
            return await self.query(query, params, conn=c, one=one)

    async def execute(self, query, params=(), *, conn=None):
        if conn:
            return await conn.execute(query, params)
        async with self.pool.connection() as c:
            return await c.execute(query, params)

    async def range(self, table, oldest, newest):
        assert table in DATED
        rows = await self.query(sql.SQL('SELECT data FROM {} WHERE day BETWEEN %s AND %s ORDER BY day,id').format(sql.Identifier(table)), (oldest, newest))
        return [r['data'] for r in rows]

    async def get(self, table, id, max_age=None):
        assert table in DATED | CACHED
        query = sql.SQL('SELECT data,fetched_at FROM {} WHERE id=%s').format(sql.Identifier(table))
        row = await self.query(query, (str(id),), one=True)
        if row and max_age is not None:
            from datetime import datetime, UTC
            if datetime.now(UTC) - row['fetched_at'] > timedelta(seconds=max_age):
                return None
        return row['data'] if row else None

    async def put(self, table, id, data, day=None, *, conn=None):
        assert table in DATED | CACHED
        if table in DATED:
            q = sql.SQL('INSERT INTO {} (id,day,data) VALUES (%s,%s,%s) ON CONFLICT(id) DO UPDATE SET day=excluded.day,data=excluded.data,fetched_at=now()').format(sql.Identifier(table))
            values = (str(id), day, Jsonb(data))
        else:
            q = sql.SQL('INSERT INTO {} (id,data) VALUES (%s,%s) ON CONFLICT(id) DO UPDATE SET data=excluded.data,fetched_at=now()').format(sql.Identifier(table))
            values = (str(id), Jsonb(data))
        await self.execute(q, values, conn=conn)

    async def replace_range(self, table, rows, oldest, newest, conn):
        assert table in DATED
        await conn.execute(sql.SQL('DELETE FROM {} WHERE day BETWEEN %s AND %s').format(sql.Identifier(table)), (oldest, newest))
        for row in rows:
            id = row.get('id', row.get('date'))
            day = (row.get('start_date_local') or row.get('date') or row['id'])[:10]
            await self.put(table, id, row, day, conn=conn)

    async def settings(self):
        rows = await self.query('SELECT data FROM sport_settings ORDER BY id')
        return {sport: r['data'] for r in rows for sport in r['data'].get('types', [])}

    async def sync_status(self):
        row = await self.query("SELECT last_success,error FROM sync_state WHERE resource='all'", one=True)
        return row or {'last_success': None, 'error': None}

    async def enqueue(self, key, kind, payload, conn=None):
        await self.execute('INSERT INTO work_items (key,kind,payload) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING', (key, kind, Jsonb(payload)), conn=conn)
        row = await self.query('SELECT kind,payload FROM work_items WHERE key=%s', (key,), one=True, conn=conn)
        if row['kind'] != kind or row['payload'] != payload:
            raise ValueError('idempotency key already used for different input')

    async def work_status(self, key):
        return await self.query('SELECT key,kind,status,attempts,error,available_at,result FROM work_items WHERE key=%s', (key,), one=True)

    async def process(self, key, handler):
        async with self.lock('work:' + key) as conn:
            if conn is None:
                return {'status': 'processing'}
            row = await self.query('SELECT *,available_at<=now() AS due FROM work_items WHERE key=%s', (key,), conn=conn, one=True)
            if not row:
                return {'status': 'missing'}
            if row['status'] == 'succeeded' or not row['due']:
                return {'status': row['status'], 'result': row['result']}
            await conn.execute("UPDATE work_items SET status='running',attempts=attempts+1,updated_at=now() WHERE key=%s", (key,))
            try:
                result = await handler(key, row['payload'])
            except Exception as exc:
                # Never store exception messages: http client errors can contain tokens or PII.
                delay = min(3600, 5 * (2 ** min(row['attempts'], 10)))
                await conn.execute("UPDATE work_items SET status='retry',error=%s,available_at=now() + %s,updated_at=now() WHERE key=%s", (type(exc).__name__, timedelta(seconds=delay), key))
                return {'status': 'retry', 'error': type(exc).__name__}
            await conn.execute("UPDATE work_items SET status='succeeded',result=%s,error=NULL,updated_at=now() WHERE key=%s", (Jsonb(result), key))
            return {'status': 'succeeded', 'result': result}

    async def due_work(self, limit=20):
        return await self.query("SELECT key,kind FROM work_items WHERE status<>'succeeded' AND available_at<=now() ORDER BY available_at LIMIT %s", (limit,))

    async def message(self, key, channel, role, content, conn=None):
        await self.execute('INSERT INTO agent_messages (message_key,channel,role,content) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING', (key, channel, role, content), conn=conn)

    async def history(self, channel='web', limit=50):
        rows = await self.query('SELECT role,content,created_at FROM agent_messages WHERE channel=%s ORDER BY id DESC LIMIT %s', (channel, limit))
        return list(reversed(rows))
