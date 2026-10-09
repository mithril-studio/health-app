from test_tools import WritableSource

from coach.config import Settings
from coach.jobs import Jobs
from coach.tools import ToolService


class FakeAgent:
    def __init__(self, store=None):
        self.calls = []
        self.store = store

    async def respond(self, message, *, key, channel="web", read_only=False, extra=None):
        self.calls.append(
            {"message": message, "key": key, "channel": channel, "read_only": read_only}
        )
        reply = "Data-grounded report"
        # Mirror the real agent: the reply is persisted under '{key}:reply'.
        if self.store is not None:
            await self.store.message(key + ":reply", channel, "assistant", reply)
        return reply


async def test_scheduled_job_stores_report_and_queues_no_notification(store):
    cfg = Settings(_env_file=None)
    tools = ToolService(store, WritableSource())
    agent = FakeAgent(store)
    jobs = Jobs(cfg, store, tools, agent)
    await jobs.accept_job({"kind": "morning", "key": "2026-10-01"})
    result = await jobs.process("job:morning:2026-10-01")
    assert result["status"] == "succeeded"
    assert agent.calls[0]["read_only"] is True
    assert agent.calls[0]["channel"] == "scheduled"
    # No notification work is ever queued now; the report is stored, not pushed out.
    assert await store.query("SELECT * FROM work_items WHERE kind='notification'") == []
    reports = await store.reports(50)
    assert len(reports) == 1
    assert reports[0]["kind"] == "morning"
    assert reports[0]["content"] == "Data-grounded report"


async def test_unknown_scheduled_kind_is_acknowledged_not_retried(store):
    cfg = Settings(_env_file=None)
    jobs = Jobs(cfg, store, ToolService(store, WritableSource()), FakeAgent(store))
    await jobs.accept_job({"kind": "weekly", "key": "2026-10-01"})
    result = await jobs.process("job:weekly:2026-10-01")
    assert result["status"] == "succeeded"
    assert (await store.work_status("job:weekly:2026-10-01"))["status"] == "succeeded"
    assert await store.reports(50) == []


async def test_unavailable_provider_keeps_jobs_queued(store):
    from coach.agent import AgentUnavailable

    class BrokenAgent:
        async def respond(self, message, **kwargs):
            raise AgentUnavailable("openrouter_unavailable")

    cfg = Settings(_env_file=None)
    jobs = Jobs(cfg, store, ToolService(store, WritableSource()), BrokenAgent())
    await jobs.accept_job({"kind": "morning", "key": "2026-10-05"})
    await jobs.accept_job({"kind": "evening", "key": "2026-10-05"})
    assert (await jobs.process("job:morning:2026-10-05"))["status"] == "retry"
    await store.execute("UPDATE work_items SET available_at=now()")
    assert (await jobs.process("job:evening:2026-10-05"))["status"] == "retry"
    retrying = await store.query("SELECT key FROM work_items WHERE status='retry' ORDER BY key")
    assert [r["key"] for r in retrying] == ["job:evening:2026-10-05", "job:morning:2026-10-05"]
