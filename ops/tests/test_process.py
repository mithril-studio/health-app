import asyncio
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import AsyncMock, patch

from ops.relay import main, run


class ProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_once_performs_one_scheduler_pass(self):
        relay = type('FakeRelay', (), {})()
        relay.start = AsyncMock()
        relay.scheduler_step = AsyncMock()
        await run(relay, once=True)
        relay.start.assert_awaited_once()
        relay.scheduler_step.assert_awaited_once_with()

    async def test_scheduler_loop_runs_until_stop_cancels(self):
        stop = asyncio.Event()
        scheduler_entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def scheduler_step():
            scheduler_entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        relay = type('FakeRelay', (), {})()
        relay.start = AsyncMock()
        relay.scheduler_step = scheduler_step
        task = asyncio.create_task(run(relay, stop=stop))
        await asyncio.wait_for(scheduler_entered.wait(), 1)
        stop.set()
        await asyncio.wait_for(task, 1)
        self.assertTrue(cancelled.is_set())


class CliTests(unittest.TestCase):
    def test_dry_run_needs_no_secrets_or_network_and_creates_no_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            target = Path(directory) / 'absent' / 'relay.sqlite'
            output = io.StringIO()
            with redirect_stdout(output), patch('httpx.AsyncClient', side_effect=AssertionError('network forbidden')):
                self.assertEqual(main(['--once', '--dry-run', '--state', str(target)]), 0)
            self.assertEqual(json.loads(output.getvalue())['network'], 'disabled')
            self.assertFalse(target.parent.exists())
