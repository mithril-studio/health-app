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
    return (isinstance(chat, dict) and chat.get('type') == 'private'
            and str(chat.get('id')) == str(chat_id) and isinstance(message.get('text'), str))
