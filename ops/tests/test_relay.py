import json
import socket
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx

from ops.relay import Config, Endpoints, Relay, RemoteFailure, StartupRefused, State, dry_run


def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class FakeEndpoints:
    """Only MockTransport is reachable; an unexpected route is a test failure."""
    def __init__(self):
        self.calls = []
        self.activities = [{'id': 'old'}]
        self.fail_job = False
        self.fail_activities = False
        self.pending = False

    async def handle(self, request):
        body = json.loads(request.content) if request.content else None
        self.calls.append((request, body))
        path = request.url.path
        if path.endswith('/activities'):
            return httpx.Response(503 if self.fail_activities else 200, json=self.activities)
        if path == '/api/internal/job':
            return httpx.Response(503 if self.fail_job else 200, json={'ok': not self.pending})
        raise AssertionError('unexpected network route')

    def bodies(self, path):
        return [body for req, body in self.calls if req.url.path == path]


class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'relay.sqlite'
        self.now = utc('2026-10-01T06:00:00')
        self.db = State(self.path)
        self.addCleanup(lambda: self.db.close())
        self.env = {'BOX_SHARED_SECRET': 'test-shared',
                    'INTERVALS_API_KEY': 'test-intervals', 'INTERVALS_ATHLETE_ID': 'i123'}
        self.config = Config.from_env(self.env)
        self.fake = FakeEndpoints()
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.fake.handle))
        self.addAsyncCleanup(self.client.aclose)
        self.remote = Endpoints(self.config, self.client)
        self.relay = Relay(self.db, self.remote, self.config, lambda: self.now)
        self.no_network = patch.object(
            socket.socket, 'connect', side_effect=AssertionError('real network forbidden')
        )
        self.no_network.start()
        self.addCleanup(self.no_network.stop)

    async def restart(self):
        self.db.close()
        self.db = State(self.path)
        self.relay = Relay(self.db, self.remote, self.config, lambda: self.now)
        await self.relay.start()

    async def test_daily_job_retry_dedup_and_no_history(self):
        await self.relay.start()
        self.now = utc('2026-10-01T06:30:00')
        self.fake.fail_job = True
        await self.relay.scheduler_step()
        await self.relay.scheduler_step()
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), 1)
        await self.restart()
        self.now += timedelta(minutes=1)
        self.fake.fail_job = False
        await self.relay.scheduler_step()
        await self.relay.scheduler_step()
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), 2)
        self.now = utc('2026-10-04T10:00:00')
        await self.restart()
        await self.relay.scheduler_step()
        self.assertEqual(self.fake.bodies('/api/internal/job')[-1],
                         {'kind': 'morning', 'key': 'morning:2026-10-04'})
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), 3)

    async def test_activity_baseline_poll_interval_and_retries(self):
        await self.relay.start()
        await self.relay.scheduler_step()
        self.assertEqual(self.fake.bodies('/api/internal/job'), [])
        self.fake.activities += [{'id': 'new'}]
        self.now += timedelta(minutes=19)
        await self.relay.scheduler_step()
        self.assertEqual(self.fake.bodies('/api/internal/job'), [])
        self.now += timedelta(minutes=1)
        self.fake.fail_job = True
        await self.relay.scheduler_step()
        self.assertEqual(self.fake.bodies('/api/internal/job'),
                         [{'kind': 'activity', 'key': 'activity:new', 'activity_id': 'new'}])
        self.fake.activities = []
        self.fake.fail_job = False
        await self.restart()
        self.now += timedelta(minutes=1)
        await self.relay.scheduler_step()
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), 2)
        self.now += timedelta(minutes=1)
        await self.relay.scheduler_step()
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), 2)

    async def test_failed_initial_snapshot_does_not_create_baseline(self):
        await self.relay.start()
        self.fake.fail_activities = True
        await self.relay.scheduler_step()
        self.assertIsNone(self.db.get('activities_initialized'))
        await self.relay.scheduler_step()
        self.assertEqual(sum(req.url.path.endswith('/activities') for req, _ in self.fake.calls), 1)
        self.now += timedelta(minutes=1)
        self.fake.fail_activities = False
        await self.relay.scheduler_step()
        self.assertEqual(self.fake.bodies('/api/internal/job'), [])
        self.assertEqual(self.db.get('activities_initialized'), '1')

    async def test_dry_run_is_offline_and_does_not_mutate_state(self):
        await self.relay.start()
        before = '\n'.join(self.db.db.iterdump())
        call_count = len(self.fake.calls)
        result = dry_run(self.path, utc('2026-10-01T07:00:00'))
        self.assertEqual(result['eligible_scheduled_jobs'], ['morning:2026-10-01'])
        self.assertEqual(len(self.fake.calls), call_count)
        self.assertEqual('\n'.join(self.db.db.iterdump()), before)
        missing = self.path.parent / 'new-dir' / 'relay.sqlite'
        self.assertEqual(dry_run(missing, self.now)['eligible_scheduled_jobs'], [])
        self.assertFalse(missing.parent.exists())

    async def test_http_auth_and_intervals_range(self):
        await self.relay.start()
        self.now = utc('2026-10-01T06:30:00')
        await self.relay.scheduler_step()
        saw_intervals = saw_backend = False
        for request, _ in self.fake.calls:
            if request.url.host == '127.0.0.1':
                saw_backend = True
                self.assertEqual(request.headers['authorization'], 'Bearer test-shared')
                self.assertEqual(request.url.port, 8001)
            elif request.url.host == 'intervals.icu':
                saw_intervals = True
                self.assertEqual(request.headers['authorization'], 'Basic QVBJX0tFWTp0ZXN0LWludGVydmFscw==')
                self.assertEqual(request.url.params['oldest'], '2026-09-28')
                self.assertEqual(request.url.params['newest'], '2026-10-02')
                self.assertTrue(request.headers.get('user-agent'))
            else:
                self.fail('unexpected network host')
        self.assertTrue(saw_intervals and saw_backend)

    async def test_backend_ok_false_is_not_acknowledged(self):
        self.fake.pending = True
        with self.assertRaises(RemoteFailure):
            await self.remote.job({'kind': 'morning', 'key': 'morning:2026-10-01'})

    async def test_failure_status_in_200_response_is_not_acknowledged(self):
        async def handler(request):
            return httpx.Response(200, json={'status': 'retry'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(RemoteFailure):
                await Endpoints(self.config, client).job({'kind': 'morning', 'key': 'morning:2026-10-01'})

    async def test_redirects_malformed_json_and_network_errors_are_redacted(self):
        for failure in ('redirect', 'json', 'network'):
            async def handler(request):
                if failure == 'redirect':
                    return httpx.Response(302, headers={'location': 'https://unexpected.invalid/token'})
                if failure == 'json':
                    return httpx.Response(200, text='secret-body')
                raise httpx.ConnectError('secret-url', request=request)
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                with self.assertRaises(RemoteFailure) as error:
                    await Endpoints(self.config, client).job({'kind': 'morning', 'key': 'morning:2026-10-01'})
                self.assertNotIn('secret', str(error.exception))

    async def test_malformed_snapshot_never_marks_baseline_complete(self):
        await self.relay.start()
        self.fake.activities = [{'id': 'good'}, {'name': 'missing ID'}]
        await self.relay.scheduler_step()
        self.assertIsNone(self.db.get('activities_initialized'))

    async def test_expired_retry_does_not_send_yesterdays_report(self):
        await self.relay.start()
        self.now = utc('2026-10-01T19:00:00')
        self.fake.fail_job = True
        await self.relay.scheduler_step()
        previous = len(self.fake.bodies('/api/internal/job'))
        self.now = utc('2026-10-01T22:01:00')  # Oct 2 in Amsterdam.
        self.fake.fail_job = False
        await self.restart()
        await self.relay.scheduler_step()
        self.assertEqual(len(self.fake.bodies('/api/internal/job')), previous)


class ConfigTests(unittest.TestCase):
    def test_requires_core_relay_settings(self):
        complete = {'BOX_SHARED_SECRET': 's', 'INTERVALS_API_KEY': 'k', 'INTERVALS_ATHLETE_ID': 'i'}
        Config.from_env(complete)  # does not raise
        for missing in complete:
            env = {k: v for k, v in complete.items() if k != missing}
            with self.assertRaises(StartupRefused):
                Config.from_env(env)
        with self.assertRaises(StartupRefused):
            Config.from_env({**complete, 'RELAY_START_DATE': '01-02-2026'})
