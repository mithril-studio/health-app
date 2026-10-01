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


def update(number, chat=42, kind='private'):
    return {'update_id': number, 'message': {'chat': {'id': chat, 'type': kind}, 'text': 'hi'}}


class FakeEndpoints:
    """Only MockTransport is reachable; an unexpected route is a test failure."""
    def __init__(self):
        self.calls = []
        self.webhook = ''
        self.activities = [{'id': 'old'}]
        self.updates = []
        self.fail_job = False
        self.fail_update = None
        self.fail_activities = False
        self.pending = False
        self.target = '42'
        self.fail_target = False
        self.reject_update = None

    async def handle(self, request):
        body = json.loads(request.content) if request.content else None
        self.calls.append((request, body))
        path = request.url.path
        if path.endswith('/getWebhookInfo'):
            return httpx.Response(200, json={'ok': True, 'result': {'url': self.webhook}})
        if path.endswith('/getUpdates'):
            offset = body.get('offset', 0)
            return httpx.Response(200, json={'ok': True, 'result': [u for u in self.updates
                                                                 if u['update_id'] >= offset]})
        if path.endswith('/activities'):
            return httpx.Response(503 if self.fail_activities else 200, json=self.activities)
        if path == '/api/internal/job':
            return httpx.Response(503 if self.fail_job else 200, json={'ok': not self.pending})
        if path == '/api/internal/telegram-target':
            return httpx.Response(503 if self.fail_target else 200, json={'chat_id': self.target})
        if path == '/api/internal/telegram':
            if self.reject_update == body['update_id']:
                return httpx.Response(403, json={'detail': 'invalid pairing'})
            if body['message']['text'].startswith('/start '):
                self.target = str(body['message']['chat']['id'])
            return httpx.Response(503 if self.fail_update == body['update_id'] else 200,
                                  json={'ok': True})
        raise AssertionError('unexpected network route (including Telegram sends)')

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
        self.env = {'TELEGRAM_TRANSPORT': 'polling', 'TELEGRAM_BOT_TOKEN': '123:fake',
                    'TELEGRAM_CHAT_ID': '42', 'BOX_SHARED_SECRET': 'test-shared',
                    'INTERVALS_API_KEY': 'test-intervals', 'INTERVALS_ATHLETE_ID': 'i123'}
        self.config = Config.from_env(self.env)
        self.fake = FakeEndpoints()
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.fake.handle))
        self.addAsyncCleanup(self.client.aclose)
        self.remote = Endpoints(self.config, self.client)
        self.relay = Relay(self.db, self.remote, self.config, lambda: self.now)
        self.no_network = patch.object(socket.socket, 'connect', side_effect=AssertionError('real network forbidden'))
        self.no_network.start()
        self.addCleanup(self.no_network.stop)

    async def restart(self):
        self.db.close()
        self.db = State(self.path)
        self.relay = Relay(self.db, self.remote, self.config, lambda: self.now)
        await self.relay.start()

    async def test_webhook_refuses_before_state_initialization_or_jobs(self):
        self.fake.webhook = 'https://someone.invalid/private-token'
        with self.assertRaises(StartupRefused) as error:
            await self.relay.start()
        self.assertNotIn('private-token', str(error.exception))
        self.assertIsNone(self.db.get('started_at'))
        self.assertEqual(len(self.fake.calls), 1)

    async def test_failed_update_blocks_later_offsets_and_survives_restart(self):
        await self.relay.start()
        self.fake.updates = [update(9, 999), update(10), update(11)]
        self.fake.fail_update = 10
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 10)
        self.assertEqual([x['update_id'] for x in self.fake.bodies('/api/internal/telegram')], [10])
        await self.restart()
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(len(self.fake.bodies('/api/internal/telegram')), 1)
        self.fake.updates = []  # Telegram may have expired its queue during an outage.
        self.fake.fail_update = None
        self.now += timedelta(minutes=1)
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 12)
        self.assertEqual(self.db.pending_updates(), [])
        self.assertEqual([x['update_id'] for x in self.fake.bodies('/api/internal/telegram')], [10, 10, 11])
        await self.restart()
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(len(self.fake.bodies('/api/internal/telegram')), 3)

    async def test_only_allowed_private_text_forwarded(self):
        await self.relay.start()
        self.fake.updates = [update(1, 99), update(2, 42, 'group'), update(3),
                             {'update_id': 4, 'edited_message': update(4)['message']},
                             {'update_id': 5, 'message': {'chat': {'id': 42, 'type': 'private'}}}]
        await self.relay.telegram_step(timeout=0)
        self.assertEqual([x['update_id'] for x in self.fake.bodies('/api/internal/telegram')], [3])
        self.assertEqual(self.db.offset, 6)

    async def test_pairing_from_unknown_chat_refreshes_target_in_same_batch(self):
        await self.relay.start()
        self.fake.target = None
        pairing = update(1, 789)
        pairing['message']['text'] = '/start ' + 'a' * 32
        self.fake.updates = [pairing, update(2, 789), update(3, 42)]
        await self.relay.telegram_step(timeout=0)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [1, 2])
        self.assertEqual(self.db.offset, 4)
        self.assertNotIn('a' * 32, '\n'.join(self.db.db.iterdump()))

    async def test_invalid_pairing_is_acknowledged_and_does_not_block_offsets(self):
        await self.relay.start()
        pairing = update(1, 789)
        pairing['message']['text'] = '/start ' + 'b' * 32
        self.fake.reject_update = 1
        self.fake.updates = [pairing, update(2), update(3, 789)]
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 4)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [1, 2])
        self.assertTrue(self.db.can_try('telegram', self.now))

    async def test_dynamic_target_overrides_env_and_refresh_failure_never_falls_back(self):
        await self.relay.start()
        self.fake.target = '789'
        self.fake.updates = [update(1), update(2, 789)]
        await self.relay.telegram_step(timeout=0)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [2])
        self.fake.fail_target = True
        self.fake.updates = [update(3), update(4, 789)]
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 3)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [2])
        self.fake.fail_target = False
        self.fake.target = '555'
        self.now += timedelta(minutes=1)
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 5)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [2])

    async def test_pending_update_rechecked_after_relink_and_backend_403_is_final(self):
        await self.relay.start()
        self.fake.fail_update = 1
        self.fake.updates = [update(1), update(2)]
        await self.relay.telegram_step(timeout=0)
        self.fake.target = '789'
        self.fake.fail_update = None
        self.now += timedelta(minutes=1)
        await self.relay.telegram_step(timeout=0)
        self.assertEqual([u['update_id'] for u in self.fake.bodies('/api/internal/telegram')], [1])
        self.assertEqual(self.db.offset, 3)
        self.fake.updates = [update(3, 789)]
        self.fake.reject_update = 3  # Relink between target fetch and forwarding.
        await self.relay.telegram_step(timeout=0)
        self.assertEqual(self.db.offset, 4)

    async def test_malformed_target_response_is_retryable_not_authorization(self):
        for body in ({}, {'chat_id': -42}, {'chat_id': True}, {'chat_id': '*'}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=body)
            )) as client:
                with self.assertRaises(RemoteFailure):
                    await Endpoints(self.config, client).target()

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

    async def test_http_auth_timeouts_and_intervals_range(self):
        await self.relay.start()
        await self.relay.scheduler_step()
        self.fake.updates = [update(1)]
        await self.relay.telegram_step(timeout=30)
        for request, body in self.fake.calls:
            if request.url.host == '127.0.0.1':
                self.assertEqual(request.headers['authorization'], 'Bearer test-shared')
                self.assertEqual(request.url.port, 8001)
            elif request.url.host == 'intervals.icu':
                self.assertEqual(request.headers['authorization'], 'Basic QVBJX0tFWTp0ZXN0LWludGVydmFscw==')
                self.assertEqual(request.url.params['oldest'], '2026-09-28')
                self.assertEqual(request.url.params['newest'], '2026-10-02')
                self.assertTrue(request.headers.get('user-agent'))
            else:
                self.assertNotIn('authorization', request.headers)
                if request.url.path.endswith('/getUpdates'):
                    self.assertEqual(body['allowed_updates'], ['message'])
                    self.assertEqual(body['timeout'], 30)
                    self.assertGreater(request.extensions['timeout']['read'], 30)

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

    async def test_poll_conflict_refuses_without_touching_webhook(self):
        async def handler(request):
            self.assertTrue(request.url.path.endswith('/getUpdates'))
            return httpx.Response(409, json={'description': 'secret URL or token'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(StartupRefused) as error:
                await Endpoints(self.config, client).updates(0, 30)
            self.assertNotIn('secret URL', str(error.exception))

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
    def test_requires_polling_and_rejects_non_private_chat_ids(self):
        for env in [{}, {'TELEGRAM_TRANSPORT': 'webhook'},
                    {'TELEGRAM_TRANSPORT': 'polling', 'TELEGRAM_CHAT_ID': '-123'}]:
            with self.assertRaises(StartupRefused):
                Config.from_env(env)
