import asyncio
import json
import re
from datetime import UTC, datetime

import httpx
import pytest
from test_guards import web  # noqa: F401
from test_jobs import FakeAgent
from test_tools import WritableSource

from coach.config import Settings
from coach.jobs import Jobs
from coach.telegram_link import TelegramLink
from coach.tools import ToolError, ToolService


def update(number=1, chat=123, text="hello", **sender):
    return {"update_id": number, "message": {
        "chat": {"id": chat, "type": "private"}, "text": text,
        "from": {"id": chat, "is_bot": False, **sender},
    }}


@pytest.fixture
async def linked_services(store):
    requests = []

    async def remote(req):
        requests.append(req)
        if req.url.path.endswith("/getMe"):
            return httpx.Response(200, json={"ok": True, "result": {
                "id": 999, "is_bot": True, "username": "coachreachybot",
            }})
        assert req.url.path.endswith("/sendMessage")
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    cfg = Settings(_env_file=None, telegram_bot_token="999:test", telegram_chat_id="999")
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        link = TelegramLink(cfg, store, client)
        tools = ToolService(store, WritableSource(), telegram_link=link)
        jobs = Jobs(cfg, store, tools, FakeAgent(), client, telegram_link=link)
        yield link, jobs, requests


async def pair(link, jobs, chat=123, number=1):
    issued = await link.issue()
    token = issued["url"].split("start=")[1]
    await jobs.accept_telegram(update(number, chat, "/start " + token))
    return token


async def test_unlinked_bot_id_is_not_configured_and_notification_retries(store, linked_services):
    link, jobs, requests = linked_services
    assert await link.status() == {"connected": False, "bot_username": "coachreachybot"}
    await store.enqueue("waiting", "notification", {"text": "report"})
    assert (await jobs.process("waiting"))["status"] == "retry"
    assert not any(r.url.path.endswith("/sendMessage") for r in requests)
    with pytest.raises(ToolError, match="linked"):
        await jobs.tools.call("plan_workout", {
            "date": "2026-10-02", "name": "Easy", "sport": "Run", "description": "Easy run",
        })
    assert await store.query("SELECT * FROM write_operations") == []


async def test_pairing_hash_expiry_atomic_single_use_and_no_token_in_outbox(store, linked_services):
    link, jobs, _ = linked_services
    issued = await link.issue()
    token = issued["url"].split("start=")[1]
    assert re.fullmatch(r"https://t.me/coachreachybot\?start=[A-Za-z0-9_-]{32}", issued["url"])
    expiry = datetime.fromisoformat(issued["expires_at"])
    assert 590 < (expiry - datetime.now(UTC)).total_seconds() <= 600
    row = await store.query("SELECT * FROM telegram_link", one=True)
    assert token not in str(row) and len(row["pairing_token_hash"]) == 64
    results = await asyncio.gather(
        jobs.accept_telegram(update(1, 123, "/start " + token)),
        jobs.accept_telegram(update(2, 456, "/start " + token)),
        return_exceptions=True,
    )
    assert sum(isinstance(r, ToolError) and r.status == 403 for r in results) == 1
    assert sum(isinstance(r, dict) and r["status"] == "paired" for r in results) == 1
    assert (await link.status())["chat_id"] in ("123", "456")
    rows = await store.query("SELECT * FROM work_items")
    assert len(rows) == 1 and rows[0]["kind"] == "notification"
    assert token not in str(rows)
    assert jobs.agent.calls == []


async def test_wrong_expired_and_superseded_tokens_do_not_link(store, linked_services):
    link, jobs, _ = linked_services
    first = (await link.issue())["url"].split("start=")[1]
    second = (await link.issue())["url"].split("start=")[1]
    for token in ("x" * 32, first, "short"):
        with pytest.raises(ToolError) as exc:
            await jobs.accept_telegram(update(text="/start " + token))
        assert exc.value.status == 403
    await store.execute("UPDATE telegram_link SET pairing_expires_at=now()-interval '1 second'")
    with pytest.raises(ToolError) as exc:
        await jobs.accept_telegram(update(text="/start " + second))
    assert exc.value.status == 403
    assert await link.target() is None
    assert await store.query("SELECT * FROM work_items") == []


async def test_pairing_requires_private_non_bot_matching_sender(linked_services):
    link, jobs, _ = linked_services
    token = (await link.issue())["url"].split("start=")[1]
    bad = [update(chat=999), update(is_bot=True), update(id=456), update(chat=-123)]
    group = update()
    group["message"]["chat"]["type"] = "group"
    missing = update()
    del missing["message"]["from"]
    for item in [*bad, group, missing]:
        item["message"]["text"] = "/start " + token
        with pytest.raises(ToolError) as exc:
            await jobs.accept_telegram(item)
        assert exc.value.status == 403
    assert await link.target() is None


async def test_relink_overrides_env_and_revokes_old_queued_messages(store, linked_services):
    link, jobs, requests = linked_services
    await pair(link, jobs)
    await jobs.accept_telegram(update(10))
    await pair(link, jobs, chat=456, number=2)
    assert await link.target() == "456"
    # A fresh resolver reads the persistent link, not the stale environment.
    assert await TelegramLink(jobs.cfg, store, jobs.client).target() == "456"
    for item in (update(11), update(12, 456, id=123), update(13, 456, is_bot=True)):
        with pytest.raises(ToolError) as exc:
            await jobs.accept_telegram(item)
        assert exc.value.status == 403
    await jobs.process("telegram:10")
    assert jobs.agent.calls == []
    await store.enqueue("dynamic", "notification", {"text": "report"})
    assert (await jobs.process("dynamic"))["result"] == {"delivered": True}
    sent = [json.loads(r.content) for r in requests if r.url.path.endswith("/sendMessage")]
    assert [r["chat_id"] for r in sent] == ["456"]
    await jobs.tools.call("plan_workout", {
        "date": "2026-10-02", "name": "Easy", "sport": "Run", "description": "Easy run",
    })
    assert await store.query("SELECT 1 FROM work_items WHERE key LIKE %s", ("echo:%",))


async def test_relink_during_sync_cannot_call_agent(linked_services, monkeypatch):
    link, jobs, _ = linked_services
    await pair(link, jobs)
    await jobs.accept_telegram(update(10))

    async def relink_during_sync():
        await pair(link, jobs, chat=456, number=2)

    monkeypatch.setattr(jobs.tools.sync, "run", relink_during_sync)
    assert (await jobs.process("telegram:10"))["result"] == {"status": "ignored"}
    assert jobs.agent.calls == []


async def test_unknown_normal_sender_never_auto_links_or_calls_agent(store, linked_services):
    link, jobs, _ = linked_services
    for text in ("hello", "/start"):
        with pytest.raises(ToolError) as exc:
            await jobs.accept_telegram(update(text=text))
        assert exc.value.status == 403
    assert await link.target() is None
    assert await store.query("SELECT * FROM work_items") == []
    assert jobs.agent.calls == []


async def test_welcome_failure_rolls_back_link_and_token_consumption(store, linked_services, monkeypatch):
    link, jobs, _ = linked_services
    token = (await link.issue())["url"].split("start=")[1]
    enqueue = store.enqueue

    async def unavailable(*args, **kwargs):
        raise RuntimeError("outbox unavailable")

    monkeypatch.setattr(store, "enqueue", unavailable)
    with pytest.raises(RuntimeError):
        await jobs.accept_telegram(update(text="/start " + token))
    assert await link.target() is None
    monkeypatch.setattr(store, "enqueue", enqueue)
    assert (await jobs.accept_telegram(update(text="/start " + token)))["status"] == "paired"


async def test_waiting_notification_resumes_after_pairing(store, linked_services):
    link, jobs, _ = linked_services
    await store.enqueue("waiting", "notification", {"text": "report"})
    assert (await jobs.process("waiting"))["status"] == "retry"
    await pair(link, jobs)
    assert (await jobs.process("waiting"))["result"] == {"delivered": True}


async def test_valid_env_fallback_and_getme_failure_fail_closed(store):
    cfg = Settings(_env_file=None, telegram_bot_token="test", telegram_chat_id="123")
    for response, expected in [
        (httpx.Response(200, json={"ok": True, "result": {"id": 999, "is_bot": True, "username": "coachreachybot"}}), "123"),
        (httpx.Response(503, text="secret upstream details"), None),
    ]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _, result=response: result)) as client:
            link = TelegramLink(cfg, store, client)
            if expected is None:
                with pytest.raises(ToolError) as failure:
                    await link.target()
                assert failure.value.status == 503
                assert "secret" not in str(failure.value)
            else:
                assert await link.target() == expected
                assert "secret" not in str(await link.status())


@pytest.mark.usefixtures("web")
async def test_pairing_and_status_are_session_only_and_internal_target_is_worker_only(web, monkeypatch):  # noqa: F811
    client, app = web

    async def identity():
        return {"id": 999, "username": "coachreachybot"}

    monkeypatch.setattr(app.state.telegram_link, "identity", identity)
    for bearer in (None, "api-secret", "mcp-secret", "worker-secret"):
        headers = {"Authorization": "Bearer " + bearer} if bearer else {}
        assert (await client.post("/api/telegram/pairing", headers=headers)).status_code in (401, 403)
        assert (await client.get("/api/telegram", headers=headers)).status_code in (401, 403)
    await client.post("/api/login", headers={"Origin": "https://coach.test"}, json={"password": "correct-password"})
    assert (await client.post("/api/telegram/pairing")).status_code == 403
    issued = await client.post("/api/telegram/pairing", headers={"Origin": "https://coach.test"})
    assert issued.status_code == 200 and "start=" in issued.json()["url"]
    assert issued.headers["cache-control"] == "no-store"
    assert (await client.get("/api/telegram")).json()["connected"] is False
    assert (await client.get("/api/internal/telegram-target")).status_code == 401
    target = await client.get("/api/internal/telegram-target", headers={"Authorization": "Bearer worker-secret"})
    assert target.status_code == 200 and target.json() == {"chat_id": None}
