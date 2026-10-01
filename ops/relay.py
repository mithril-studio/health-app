"""Coach Reachy's local scheduler and Telegram polling relay."""
from __future__ import annotations

import fcntl
import json
import os
import sqlite3
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

AMSTERDAM = ZoneInfo('Europe/Amsterdam')
POLL_INTERVAL = 20 * 60


def utc_now():
    return datetime.now(timezone.utc)


def due_jobs(now, started_at, start_date=None):
    """Only today's slots strictly after the durable first-start timestamp."""
    local = now.astimezone(AMSTERDAM)
    day = local.date()
    if start_date and day.isoformat() < start_date:
        return []
    result = []
    for kind, slot in [('morning', time(8, 30)), ('evening', time(21))]:
        scheduled = datetime.combine(day, slot, AMSTERDAM)
        if started_at < scheduled <= now:
            result.append({'kind': kind, 'key': f'{kind}:{day.isoformat()}'})
    return result


def retry_delay(attempts):
    return min(3600, 60 * 2 ** min(attempts - 1, 6))


class AlreadyRunning(Exception):
    pass


class ProcessLock:
    """Keep the descriptor alive: the kernel releases flock even on SIGKILL."""
    def __init__(self, state_path):
        self.path = Path(str(state_path) + '.lock')
        self.fd = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.fd)
            self.fd = None
            raise AlreadyRunning('another relay owns this state directory') from None
        return self

    def __exit__(self, *args):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


class State:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (
                key TEXT PRIMARY KEY, kind TEXT NOT NULL, activity_id TEXT,
                day TEXT NOT NULL, created_at REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS seen_activities (id TEXT PRIMARY KEY, first_seen REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS retries (
                name TEXT PRIMARY KEY, attempts INTEGER NOT NULL, next_attempt REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS inbox (update_id INTEGER PRIMARY KEY, payload TEXT);
        ''')

    def close(self):
        self.db.close()

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def _set(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES (?, ?)', (key, str(value)))

    def set(self, key, value):
        with self.db:
            self._set(key, value)

    def initialize(self, now):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO meta VALUES (?, ?)',
                            ('started_at', now.isoformat()))
        return datetime.fromisoformat(self.get('started_at'))

    def _enqueue(self, job, now):
        self.db.execute('''INSERT OR IGNORE INTO jobs
            (key, kind, activity_id, day, created_at) VALUES (?, ?, ?, ?, ?)''',
            (job['key'], job['kind'], job.get('activity_id'),
             now.astimezone(AMSTERDAM).date().isoformat(), now.timestamp()))

    def enqueue(self, job, now):
        with self.db:
            self._enqueue(job, now)

    def observe_activities(self, ids, now):
        # Snapshot and queue are one transaction: a crash cannot mark a new ID
        # seen without preserving its pending backend job.
        baseline = self.get('activities_initialized') is None
        with self.db:
            for activity_id in ids:
                inserted = self.db.execute('INSERT OR IGNORE INTO seen_activities VALUES (?, ?)',
                                           (activity_id, now.timestamp())).rowcount
                if inserted and not baseline:
                    self._enqueue({'kind': 'activity', 'key': f'activity:{activity_id}',
                                   'activity_id': activity_id}, now)
            self._set('activities_initialized', '1')
            self._set('activities_next_poll', now.timestamp() + POLL_INTERVAL)

    def ready(self, now):
        day = now.astimezone(AMSTERDAM).date().isoformat()
        with self.db:
            self.db.execute('''UPDATE jobs SET status='expired' WHERE status='pending' AND
                ((kind != 'activity' AND day < ?) OR (kind='activity' AND created_at < ?))''',
                (day, now.timestamp() - 3 * 86400))
        return self.db.execute('''SELECT * FROM jobs WHERE status='pending' AND day <= ?
            AND next_attempt <= ? ORDER BY created_at, key LIMIT 10''',
            (day, now.timestamp())).fetchall()

    def complete(self, key):
        with self.db:
            self.db.execute("UPDATE jobs SET status='sent' WHERE key=?", (key,))

    def fail_job(self, key, now):
        attempts = self.db.execute('SELECT attempts FROM jobs WHERE key=?', (key,)).fetchone()[0] + 1
        with self.db:
            self.db.execute('UPDATE jobs SET attempts=?, next_attempt=? WHERE key=?',
                            (attempts, now.timestamp() + retry_delay(attempts), key))

    def can_try(self, name, now):
        row = self.db.execute('SELECT next_attempt FROM retries WHERE name=?', (name,)).fetchone()
        return row is None or now.timestamp() >= row[0]

    def fail(self, name, now):
        row = self.db.execute('SELECT attempts FROM retries WHERE name=?', (name,)).fetchone()
        attempts = row[0] + 1 if row else 1
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO retries VALUES (?, ?, ?)',
                            (name, attempts, now.timestamp() + retry_delay(attempts)))

    def succeeded(self, name):
        with self.db:
            self.db.execute('DELETE FROM retries WHERE name=?', (name,))

    @property
    def offset(self):
        return int(self.get('telegram_offset', 0))

    def save_updates(self, updates, chat_id):
        with self.db:
            for update in updates:
                if update['update_id'] >= self.offset:
                    # Persist authorized input for outages beyond Telegram's retention;
                    # unwanted updates retain only an ID, never someone else's message.
                    payload = json.dumps(update) if authorized_update(update, chat_id) else None
                    self.db.execute('INSERT OR IGNORE INTO inbox VALUES (?, ?)',
                                    (update['update_id'], payload))

    def pending_updates(self):
        return self.db.execute('SELECT * FROM inbox ORDER BY update_id').fetchall()

    def acknowledge(self, update_id):
        with self.db:
            self._set('telegram_offset', max(self.offset, update_id + 1))
            self.db.execute('DELETE FROM inbox WHERE update_id=?', (update_id,))


def authorized_update(update, chat_id):
    message = update.get('message')
    if not isinstance(message, dict):
        return False
    chat = message.get('chat')
    return (chat_id is not None and isinstance(chat, dict) and chat.get('type') == 'private'
            and str(chat.get('id')) == str(chat_id) and isinstance(message.get('text'), str))


def pairing_update(update):
    message = update.get('message')
    if not isinstance(message, dict):
        return False
    chat, text = message.get('chat'), message.get('text')
    return (isinstance(chat, dict) and chat.get('type') == 'private'
            and type(chat.get('id')) is int and chat['id'] > 0
            and isinstance(text, str) and text.startswith('/start '))


class StartupRefused(Exception):
    """A safe operator-facing reason; never include remote bodies or URLs."""


class RemoteFailure(Exception):
    """Retryable failure with deliberately redacted diagnostics."""


class Config:
    def __init__(self, env):
        self.token = env['TELEGRAM_BOT_TOKEN']
        self.chat_id = env.get('TELEGRAM_CHAT_ID', '')
        self.shared_secret = env['BOX_SHARED_SECRET']
        self.intervals_key = env['INTERVALS_API_KEY']
        self.athlete_id = env['INTERVALS_ATHLETE_ID']
        self.start_date = env.get('RELAY_START_DATE') or None

    @classmethod
    def from_env(cls, env):
        import re
        if env.get('TELEGRAM_TRANSPORT') != 'polling':
            raise StartupRefused('TELEGRAM_TRANSPORT must be polling')
        required = ['TELEGRAM_BOT_TOKEN', 'BOX_SHARED_SECRET',
                    'INTERVALS_API_KEY', 'INTERVALS_ATHLETE_ID']
        if any(not env.get(key, '').strip() for key in required):
            raise StartupRefused('required relay environment settings are missing')
        if env.get('TELEGRAM_CHAT_ID') and not re.fullmatch(r'[1-9][0-9]*', env['TELEGRAM_CHAT_ID']):
            raise StartupRefused('TELEGRAM_CHAT_ID must identify a private user chat')
        if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', env['TELEGRAM_BOT_TOKEN']):
            raise StartupRefused('TELEGRAM_BOT_TOKEN has invalid format')
        start_date = env.get('RELAY_START_DATE')
        if start_date:
            try:
                if datetime.strptime(start_date, '%Y-%m-%d').date().isoformat() != start_date:
                    raise ValueError
            except ValueError:
                raise StartupRefused('RELAY_START_DATE must be YYYY-MM-DD') from None
        return cls(env)


class Endpoints:
    def __init__(self, config, client):
        self.config = config
        self.client = client

    async def request(self, method, url, *, ignore_forbidden=False, **kwargs):
        import httpx
        try:
            response = await self.client.request(method, url, follow_redirects=False, **kwargs)
            if ignore_forbidden and response.status_code == 403:
                return {'status': 'ignored'}
            if response.status_code == 409 and url.startswith('https://api.telegram.org/'):
                raise StartupRefused('Telegram polling conflict; stop competing transport before restart')
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError):
            raise RemoteFailure('remote request failed') from None
        return result

    async def telegram(self, method, payload, timeout=30):
        result = await self.request('POST', f'https://api.telegram.org/bot{self.config.token}/{method}',
                                    json=payload, timeout=timeout)
        if not isinstance(result, dict) or result.get('ok') is not True or 'result' not in result:
            raise RemoteFailure('invalid Telegram response')
        return result['result']

    async def verify_polling(self):
        info = await self.telegram('getWebhookInfo', {})
        if not isinstance(info, dict) or not isinstance(info.get('url'), str):
            raise RemoteFailure('invalid Telegram webhook response')
        if info['url']:
            raise StartupRefused('existing Telegram webhook detected; polling refused; webhook unchanged')

    async def updates(self, offset, timeout):
        result = await self.telegram('getUpdates', {'offset': offset, 'timeout': timeout,
                                      'limit': 100, 'allowed_updates': ['message']}, timeout=timeout + 15)
        if (not isinstance(result, list) or any(not isinstance(item, dict)
                or type(item.get('update_id')) is not int or item['update_id'] < 0 for item in result)):
            raise RemoteFailure('invalid Telegram updates')
        return sorted(result, key=lambda item: item['update_id'])

    async def backend(self, path, payload):
        # The backend generates the agent response and owns Telegram delivery.
        # Replaying the same job key or update_id must be idempotent there.
        result = await self.request('POST', 'http://127.0.0.1:8001/api/internal/' + path,
                                    headers={'Authorization': f'Bearer {self.config.shared_secret}'},
                                    json=payload, timeout=180, ignore_forbidden=path == 'telegram')
        if (not isinstance(result, dict) or result.get('ok') is False
                or result.get('status') in ('retry', 'failed', 'error', 'processing', 'running', 'pending')):
            raise RemoteFailure('backend did not acknowledge work')
        return result

    async def job(self, payload):
        return await self.backend('job', payload)

    async def forward_update(self, payload):
        return await self.backend('telegram', payload)

    async def target(self):
        import re
        result = await self.request('GET', 'http://127.0.0.1:8001/api/internal/telegram-target',
                                    headers={'Authorization': f'Bearer {self.config.shared_secret}'},
                                    timeout=20)
        if not isinstance(result, dict) or 'chat_id' not in result:
            raise RemoteFailure('invalid Telegram target response')
        target = result['chat_id']
        if target is None:
            return None
        if type(target) not in (str, int) or not re.fullmatch(r'[1-9][0-9]*', str(target)):
            raise RemoteFailure('invalid Telegram target response')
        return str(target)

    async def activities(self, now):
        from urllib.parse import quote
        import httpx
        day = now.astimezone(AMSTERDAM).date()
        result = await self.request('GET', 'https://intervals.icu/api/v1/athlete/'
                                    + quote(self.config.athlete_id, safe='') + '/activities',
                                    auth=httpx.BasicAuth('API_KEY', self.config.intervals_key),
                                    headers={'User-Agent': 'CoachReachy/1.0'},
                                    params={'oldest': (day - timedelta(days=3)).isoformat(),
                                            'newest': (day + timedelta(days=1)).isoformat()}, timeout=30)
        if not isinstance(result, list) or any(not isinstance(item, dict)
                or type(item.get('id')) not in (str, int) or not str(item['id']) for item in result):
            raise RemoteFailure('invalid Intervals response')
        return [str(item['id']) for item in result]


class Relay:
    def __init__(self, state, endpoints, config, clock=utc_now):
        self.state = state
        self.endpoints = endpoints
        self.config = config
        self.clock = clock
        self.started_at = None

    async def start(self):
        # Refuse a webhook before initializing scheduling or forwarding anything.
        await self.endpoints.verify_polling()
        self.started_at = self.state.initialize(self.clock())

    async def scheduler_step(self):
        import logging
        now = self.clock()
        for job in due_jobs(now, self.started_at, self.config.start_date):
            self.state.enqueue(job, now)
        if (now.timestamp() >= float(self.state.get('activities_next_poll', 0))
                and self.state.can_try('intervals', now)):
            try:
                ids = await self.endpoints.activities(now)
            except RemoteFailure:
                self.state.fail('intervals', self.clock())
                logging.warning('Intervals poll failed; retry scheduled')
            else:
                self.state.observe_activities(ids, self.clock())
                self.state.succeeded('intervals')
        for row in self.state.ready(self.clock()):
            if row['kind'] != 'activity' and row['day'] != self.clock().astimezone(AMSTERDAM).date().isoformat():
                continue  # A slow preceding call may have crossed midnight.
            payload = {'kind': row['kind'], 'key': row['key']}
            if row['activity_id'] is not None:
                payload['activity_id'] = row['activity_id']
            try:
                await self.endpoints.job(payload)
            except RemoteFailure:
                self.state.fail_job(row['key'], self.clock())
                logging.warning('Backend job failed; retry scheduled')
            else:
                self.state.complete(row['key'])
                logging.info('Backend job acknowledged')

    async def telegram_step(self, timeout=30):
        import logging
        if not self.state.can_try('telegram', self.clock()):
            return

        async def drain():
            for row in self.state.pending_updates():
                if row['payload'] is not None:
                    update = json.loads(row['payload'])
                    # Never fall back to config or a cached target after lookup failure.
                    target = await self.endpoints.target()
                    if authorized_update(update, target):
                        await self.endpoints.forward_update(update)
                self.state.acknowledge(row['update_id'])

        try:
            if self.state.pending_updates():
                await drain()
            else:
                updates = await self.endpoints.updates(self.state.offset, timeout)
                while updates:
                    # Pairing capabilities never enter the SQLite inbox. Process each
                    # directly, then refresh authorization for the rest of this batch.
                    split = next((i for i, item in enumerate(updates) if pairing_update(item)), len(updates))
                    if split:
                        target = await self.endpoints.target()
                        self.state.save_updates(updates[:split], target)
                        await drain()
                    if split < len(updates):
                        pairing = updates[split]
                        await self.endpoints.forward_update(pairing)
                        self.state.acknowledge(pairing['update_id'])
                    updates = updates[split + 1:]
            self.state.succeeded('telegram')
        except RemoteFailure:
            self.state.fail('telegram', self.clock())
            logging.warning('Telegram relay failed; retry scheduled; offset preserved')


def dry_run(path, now, start_date=None):
    """Offline inspection; never creates state, contacts providers, or acknowledges updates."""
    path = Path(path)
    started = now
    done = set()
    pending_jobs = pending_updates = 0
    baseline = False
    if path.exists():
        db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            meta = dict(db.execute('SELECT key, value FROM meta'))
            started = datetime.fromisoformat(meta.get('started_at', now.isoformat()))
            done = {row[0] for row in db.execute("SELECT key FROM jobs WHERE status='sent'")}
            pending_jobs = db.execute("SELECT count(*) FROM jobs WHERE status='pending'").fetchone()[0]
            pending_updates = db.execute('SELECT count(*) FROM inbox').fetchone()[0]
            baseline = 'activities_initialized' in meta
        finally:
            db.close()
    return {'mode': 'dry-run', 'network': 'disabled', 'timezone': 'Europe/Amsterdam',
            'eligible_scheduled_jobs': [job['key'] for job in due_jobs(now, started, start_date)
                                        if job['key'] not in done],
            'pending_jobs': pending_jobs, 'pending_telegram_updates': pending_updates,
            'activity_baseline_initialized': baseline}


async def run(relay, once=False, stop=None):
    import asyncio
    await relay.start()
    if once:
        await relay.scheduler_step()
        await relay.telegram_step(timeout=0)
        return
    stop = stop or asyncio.Event()

    async def loop(step, interval):
        while not stop.is_set():
            await step()
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

    tasks = [asyncio.create_task(loop(relay.scheduler_step, 30)),
             asyncio.create_task(loop(relay.telegram_step, 1)),
             asyncio.create_task(stop.wait())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()  # Fatal transport conflicts must stop both loops.
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def serve(config, state, once):
    import asyncio
    import signal
    import httpx
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False,
                                     headers={'User-Agent': 'CoachReachy/1.0'}) as client:
            await run(Relay(state, Endpoints(config, client), config), once=once, stop=stop)
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)


def main(argv=None):
    import argparse
    import asyncio
    import logging
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path('/opt/coach-reachy/state/relay.sqlite'))
    parser.add_argument('--once', action='store_true', help='one LIVE pass; pair with --dry-run for offline verification')
    parser.add_argument('--dry-run', action='store_true', help='offline read-only plan; no API calls or state changes')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    # HTTP debug/info records can contain the Telegram bot token in the URL.
    for name in ('httpx', 'httpcore'):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    try:
        if args.dry_run:
            print(json.dumps(dry_run(args.state, utc_now(), os.environ.get('RELAY_START_DATE')), sort_keys=True))
            return 0
        config = Config.from_env(os.environ)
        os.umask(0o077)
        with ProcessLock(args.state):
            state = State(args.state)
            try:
                asyncio.run(serve(config, state, args.once))
            finally:
                state.close()
        return 0
    except StartupRefused as error:
        logging.error('%s', error)
        return 78
    except AlreadyRunning:
        logging.error('Another relay owns the state directory; startup refused')
        return 75
    except KeyboardInterrupt:
        return 0
    except Exception:
        # Do not print exception text/tracebacks: network errors may embed secrets.
        logging.error('Relay stopped after an internal or connectivity failure; check configuration and service health')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
