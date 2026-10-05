import httpx
import pytest
from test_tools import WritableSource

from coach.config import Settings
from coach.jobs import Jobs, notification_chunks
from coach.tools import ToolError, ToolService


class FakeAgent:
    def __init__(self):
        self.calls = []

    async def respond(self, message, **kwargs):
        self.calls.append(kwargs)
        return "Data-grounded report"


async def test_jobs_read_only_and_notification_survives_send_failure(store):
    sends = []

    async def remote(req):
        if req.url.path.endswith("/getMe"):
            return httpx.Response(200, json={"ok": True, "result": {
                "id": 999, "is_bot": True, "username": "coachreachybot",
            }})
        sends.append(req)
        if len(sends) == 1:
            return httpx.Response(503, json={"ok": False})
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    cfg = Settings(_env_file=None, telegram_bot_token="test", telegram_chat_id="123")
    tools = ToolService(store, WritableSource(), telegram_configured=True)
    agent = FakeAgent()
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        jobs = Jobs(cfg, store, tools, agent, client)
        await jobs.accept_job({"kind": "morning", "key": "2026-10-01"})
        await jobs.process("job:morning:2026-10-01")
        assert agent.calls[0]["read_only"] is True
        key = "reply:job:morning:2026-10-01"
        assert (await jobs.process(key))["status"] == "retry"
        await store.execute("UPDATE work_items SET available_at=now() WHERE key=%s", (key,))
        assert (await jobs.process(key))["status"] == "succeeded"
        await jobs.process(key)
        assert len(sends) == 2


async def test_telegram_lock_dedup_and_payload_minimization(store):
    cfg = Settings(_env_file=None, telegram_bot_token="test", telegram_chat_id="123")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, json={"ok": True, "result": {"id": 999, "is_bot": True, "username": "coachreachybot"}}
    ))) as client:
        jobs = Jobs(cfg, store, ToolService(store, WritableSource()), FakeAgent(), client)
        bad = {"update_id": 42, "message": {"chat": {"id": 999}, "text": "hello"}}
        with pytest.raises(ToolError):
            await jobs.accept_telegram(bad)
        good = {
            "update_id": 42,
            "message": {
                "chat": {"id": 123, "type": "private", "first_name": "private"},
                "text": "hello",
                "from": {"id": 123, "is_bot": False, "first_name": "private"},
            },
        }
        await jobs.accept_telegram(good)
        await jobs.accept_telegram(good)
        rows = await store.query("SELECT * FROM work_items")
        assert len(rows) == 1 and rows[0]["payload"] == {"text": "hello", "chat_id": "123"}


def test_telegram_chunks_respect_utf16_limit():
    chunks = notification_chunks("🙂" * 9000)
    assert "".join(chunks) == "🙂" * 9000
    assert all(len(c.encode("utf-16-le")) <= 8000 for c in chunks)


async def test_unreachable_claude_alerts_owner_once_per_day_and_keeps_job_queued(store):
    from coach.agent import AgentUnavailable

    class BrokenAgent:
        async def respond(self, message, **kwargs):
            raise AgentUnavailable("Claude login on the server expired")

    cfg = Settings(_env_file=None, telegram_bot_token="test", telegram_chat_id="123")
    async with httpx.AsyncClient() as client:
        jobs = Jobs(cfg, store, ToolService(store, WritableSource()), BrokenAgent(), client)
        await jobs.accept_job({"kind": "morning", "key": "2026-10-05"})
        await jobs.accept_job({"kind": "evening", "key": "2026-10-05"})
        assert (await jobs.process("job:morning:2026-10-05"))["status"] == "retry"
        await store.execute("UPDATE work_items SET available_at=now()")
        assert (await jobs.process("job:evening:2026-10-05"))["status"] == "retry"
    alerts = await store.query(
        "SELECT key,payload FROM work_items WHERE kind='notification' AND key LIKE %s",
        ("alert:agent:%",),
    )
    assert len(alerts) == 1 and "expired" in alerts[0]["payload"]["text"]
    assert "login" in alerts[0]["payload"]["text"]
    retrying = await store.query("SELECT key FROM work_items WHERE status='retry' ORDER BY key")
    assert [r["key"] for r in retrying] == ["job:evening:2026-10-05", "job:morning:2026-10-05"]
