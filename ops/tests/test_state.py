import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from ops.relay import AlreadyRunning, ProcessLock, State, due_jobs


def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class ScheduleTests(unittest.TestCase):
    def test_first_start_does_not_send_already_due_reports(self):
        now = utc('2026-10-01T20:00:00')
        self.assertEqual(due_jobs(now, now), [])
        self.assertEqual(due_jobs(now, utc('2026-10-01T18:59:59')),
                         [{'kind': 'evening', 'key': 'evening:2026-10-01'}])

    def test_restart_catches_up_only_today_since_initial_start(self):
        self.assertEqual(due_jobs(utc('2026-10-03T20:00:00'), utc('2026-10-01T07:00:00')),
                         [{'kind': 'morning', 'key': 'morning:2026-10-03'},
                          {'kind': 'evening', 'key': 'evening:2026-10-03'}])

    def test_explicit_start_date(self):
        self.assertEqual(due_jobs(utc('2026-10-01T20:00:00'), utc('2026-09-01T00:00:00'),
                                  '2026-10-02'), [])

    def test_dst_both_transitions_and_slots(self):
        for day, morning, evening in [('2026-03-28', '07:30', '20:00'),
                                      ('2026-03-29', '06:30', '19:00'),
                                      ('2026-10-24', '06:30', '19:00'),
                                      ('2026-10-25', '07:30', '20:00')]:
            with self.subTest(day=day):
                started = utc(day + 'T00:00:00')
                before = utc(day + 'T' + morning + ':00').timestamp() - 1
                self.assertEqual(due_jobs(datetime.fromtimestamp(before, timezone.utc), started), [])
                self.assertEqual(len(due_jobs(utc(day + 'T' + morning + ':00'), started)), 1)
                self.assertEqual(len(due_jobs(utc(day + 'T' + evening + ':00'), started)), 2)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'relay.sqlite'
        self.now = utc('2026-10-01T06:00:00')
        self.db = State(self.path)
        self.addCleanup(lambda: self.db.close())
        self.db.initialize(self.now)

    def restart(self):
        self.db.close()
        self.db = State(self.path)

    def test_start_time_and_sent_jobs_survive_restart(self):
        job = {'kind': 'morning', 'key': 'morning:2026-10-01'}
        self.db.enqueue(job, self.now)
        self.db.complete(job['key'])
        self.restart()
        self.assertEqual(self.db.initialize(utc('2026-10-02T06:00:00')), self.now)
        self.db.enqueue(job, self.now)
        self.assertEqual(self.db.ready(self.now), [])

    def test_activity_baseline_then_durable_queue(self):
        self.db.observe_activities(['old1', 'old2'], self.now)
        self.assertEqual(self.db.ready(self.now), [])
        self.restart()
        self.db.observe_activities(['old2', 'new'], self.now)
        self.assertEqual([dict(row)['key'] for row in self.db.ready(self.now)], ['activity:new'])
        self.restart()
        self.db.observe_activities(['new'], self.now)
        self.assertEqual(len(self.db.ready(self.now)), 1)
        self.db.complete('activity:new')
        self.assertEqual(self.db.ready(self.now), [])

    def test_persistent_exponential_backoff_and_daily_expiry(self):
        job = {'kind': 'morning', 'key': 'morning:2026-10-01'}
        self.db.enqueue(job, self.now)
        self.db.fail_job(job['key'], self.now)
        self.restart()
        self.assertEqual(self.db.ready(self.now), [])
        later = utc('2026-10-01T06:01:00')
        self.assertEqual(len(self.db.ready(later)), 1)
        self.db.fail_job(job['key'], later)
        self.assertEqual(self.db.ready(utc('2026-10-01T06:02:00')), [])
        self.assertEqual(self.db.ready(utc('2026-10-02T06:00:00')), [])

    def test_lock_excludes_second_process_and_is_released(self):
        with ProcessLock(self.path):
            with self.assertRaises(AlreadyRunning):
                with ProcessLock(self.path):
                    self.fail('lock allowed a duplicate process')
        with ProcessLock(self.path):
            pass

    def test_retry_state_survives_restart(self):
        self.db.fail('telegram', self.now)
        self.restart()
        self.assertFalse(self.db.can_try('telegram', self.now))
        self.assertTrue(self.db.can_try('telegram', utc('2026-10-01T06:01:00')))
        self.db.succeeded('telegram')
        self.assertTrue(self.db.can_try('telegram', self.now))

    def test_retry_frequency_remains_capped_after_many_failures(self):
        for _ in range(100):
            self.db.fail('telegram', self.now)
        self.restart()
        self.assertFalse(self.db.can_try('telegram', utc('2026-10-01T06:59:59')))
        self.assertTrue(self.db.can_try('telegram', utc('2026-10-01T07:00:00')))
