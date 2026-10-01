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
    async def test_once_performs_one_nonblocking_poll_and_scheduler_pass(self):
        relay = type('FakeRelay', (), {})()
        relay.start = AsyncMock()
        relay.scheduler_step = AsyncMock()
        relay.telegram_step = AsyncMock()
        await run(relay, once=True)
        relay.start.assert_awaited_once()
        relay.scheduler_step.assert_awaited_once()
        relay.telegram_step.assert_awaited_once_with(timeout=0)

    async def test_scheduler_continues_while_telegram_is_slow_and_stop_cancels(self):
        stop = asyncio.Event()
        telegram_entered = asyncio.Event()
        scheduler_ran = asyncio.Event()
        cancelled = asyncio.Event()

        async def telegram_step():
            telegram_entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async def scheduler_step():
            await telegram_entered.wait()
            scheduler_ran.set()

        relay = type('FakeRelay', (), {})()
        relay.start = AsyncMock()
        relay.scheduler_step = scheduler_step
        relay.telegram_step = telegram_step
        task = asyncio.create_task(run(relay, stop=stop))
        await asyncio.wait_for(scheduler_ran.wait(), 1)
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
