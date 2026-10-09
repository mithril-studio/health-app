import asyncio

import httpx
import pytest
from test_tools import WritableSource

from coach.app import create_app
from coach.config import Settings


@pytest.fixture
async def web(store):
    cfg = Settings(
        _env_file=None,
        app_password="correct-password",
        app_origin="https://coach.test",
        api_auth_token="api-secret",
        mcp_auth_token="mcp-secret",
        box_shared_secret="worker-secret",
        background_enabled=False,
    )
    app = create_app(cfg, store=store, source=WritableSource())
    ready, stop = asyncio.Event(), asyncio.Event()

    async def lifecycle():
        async with app.router.lifespan_context(app):
            ready.set()
            await stop.wait()

    task = asyncio.create_task(lifecycle())
    await asyncio.wait_for(ready.wait(), 5)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://coach.test"
        ) as client:
            yield client, app
    finally:
        stop.set()
        await task


async def test_api_guards_and_token_scope_separation(web):
    c, app = web
    assert (await c.get("/api/session")).json() == {
        "authenticated": False,
        "cookie_received": False,
    }
    assert (await c.get("/api/dashboard")).status_code == 401
    for path, wrong, _right in [
        ("/api/dashboard", "mcp-secret", "api-secret"),
        ("/api/internal/job", "api-secret", "worker-secret"),
        ("/mcp", "api-secret", "mcp-secret"),
    ]:
        r = (
            await c.post(path, headers={"Authorization": "Bearer " + wrong}, json={})
            if path != "/api/dashboard"
            else await c.get(path, headers={"Authorization": "Bearer " + wrong})
        )
        assert r.status_code == 401
    assert (
        await c.get("/api/dashboard", headers={"Authorization": "Bearer api-secret"})
    ).status_code == 200
    assert (await c.get("/api/health")).json() == {"ready": True}


async def test_login_cookie_origin_logout_and_no_secrets_in_validation(web):
    c, _ = web
    assert (await c.post("/api/login", json={"password": "correct-password"})).status_code == 403
    assert (
        await c.post(
            "/api/login",
            headers={"Origin": "https://evil.test"},
            json={"password": "correct-password"},
        )
    ).status_code == 403
    r = await c.post(
        "/api/login",
        headers={"Origin": "https://coach.test"},
        json={"password": "correct-password"},
    )
    cookie = r.headers["set-cookie"].lower()
    assert all(v in cookie for v in ("secure", "httponly", "samesite=strict"))
    assert (await c.get("/api/session")).json() == {"authenticated": True, "cookie_received": True}
    assert (await c.post("/api/sync")).status_code == 403
    r = await c.post(
        "/api/login",
        headers={"Origin": "https://coach.test"},
        json={"password": "secret", "extra": "credential"},
    )
    assert r.status_code == 422 and "credential" not in r.text and "secret" not in r.text
    assert (
        await c.post("/api/logout", headers={"Origin": "https://coach.test"})
    ).status_code == 200
    assert (await c.get("/api/dashboard")).status_code == 401


@pytest.mark.parametrize("split_headers", [False, True])
async def test_session_survives_unrelated_browser_cookies(web, split_headers):
    c, _ = web
    response = await c.post(
        "/api/login",
        headers={"Origin": "https://coach.test"},
        json={"password": "correct-password"},
    )
    session = response.headers["set-cookie"].split(";", 1)[0]
    # A parent-domain cookie may contain a raw JSON value accepted by browsers.
    unrelated = 'preferences={"theme":"dark"}'
    headers = (
        [("Cookie", session), ("Cookie", unrelated)]
        if split_headers
        else [("Cookie", unrelated + "; " + session)]
    )
    assert (await c.get("/api/session", headers=headers)).json()["authenticated"] is True
    assert (await c.get("/api/dashboard", headers=headers)).status_code == 200
    # Unrelated cookies cannot authenticate or rescue a forged session token.
    assert (await c.get("/api/dashboard", headers={"Cookie": unrelated})).status_code == 401
    assert (
        await c.get("/api/session", headers={"Cookie": "__Host-coach_session=forged"})
    ).json() == {
        "authenticated": False,
        "cookie_received": True,
    }
    assert (
        await c.get(
            "/api/dashboard", headers={"Cookie": unrelated + "; __Host-coach_session=forged"}
        )
    ).status_code == 401


async def test_conversation_history_is_persistent_and_isolated(web, store, monkeypatch):
    c, app = web
    headers = {"Authorization": "Bearer api-secret", "Origin": "https://coach.test"}
    assert (await c.get("/api/conversations")).status_code == 401
    await store.message("legacy:user", "web", "user", "Existing conversation")
    await store.message("scheduled:user", "scheduled", "user", "Scheduled report thread")
    listing = (await c.get("/api/conversations", headers=headers)).json()["conversations"]
    assert len(listing) == 1 and listing[0]["id"] == "web"
    assert listing[0]["title"] == "Existing conversation"
    created = (await c.post("/api/conversations", headers=headers, json={})).json()
    thread = created["id"]
    assert thread != "web"
    assert (await c.get("/api/chat", params={"conversation_id": thread}, headers=headers)).json()[
        "messages"
    ] == []

    async def sync():
        pass

    async def respond(message, *, key, channel):
        await store.message(key + ":user", channel, "user", message)
        await store.message(key + ":reply", channel, "assistant", "A focused reply")
        return "A focused reply"

    monkeypatch.setattr(app.state.tools.sync, "run", sync)
    monkeypatch.setattr(app.state.agent, "respond", respond)
    result = await c.post(
        "/api/chat", headers=headers, json={"message": "New question", "conversation_id": thread}
    )
    assert result.status_code == 200
    history = (
        await c.get("/api/chat", params={"conversation_id": thread}, headers=headers)
    ).json()["messages"]
    assert [m["content"] for m in history] == ["New question", "A focused reply"]
    legacy = (await c.get("/api/chat", headers=headers)).json()["messages"]
    assert [m["content"] for m in legacy] == ["Existing conversation"]
    listing = (await c.get("/api/conversations", headers=headers)).json()["conversations"]
    assert listing[0]["id"] == thread and listing[0]["title"] == "New question"
    # Reserved channels never parse as conversation ids, so they can never receive posts.
    for reserved in ("scheduled", "reports"):
        assert (
            await c.get("/api/chat", params={"conversation_id": reserved}, headers=headers)
        ).status_code == 422
    assert (
        await c.get("/api/chat", params={"conversation_id": "web:" + "0" * 32}, headers=headers)
    ).status_code == 404


async def test_login_rate_limit_survives_requests(web):
    c, _ = web
    for _ in range(5):
        assert (
            await c.post(
                "/api/login", headers={"Origin": "https://coach.test"}, json={"password": "wrong"}
            )
        ).status_code == 401
    assert (
        await c.post(
            "/api/login", headers={"Origin": "https://coach.test"}, json={"password": "wrong"}
        )
    ).status_code == 429


async def test_confirmation_rejects_all_service_tokens(web):
    c, _ = web
    for token in ("api-secret", "mcp-secret", "worker-secret"):
        r = await c.post(
            "/api/confirmations/opaque-token/confirm",
            headers={"Authorization": "Bearer " + token},
            json={},
        )
        assert r.status_code in (401, 403)


async def test_removed_telegram_routes_return_404(web):
    c, _ = web
    api = {"Authorization": "Bearer api-secret", "Origin": "https://coach.test"}
    worker = {"Authorization": "Bearer worker-secret", "Origin": "https://coach.test"}
    assert (await c.get("/api/telegram", headers=api)).status_code == 404
    assert (await c.post("/api/telegram/pairing", headers=api)).status_code == 404
    assert (await c.get("/api/internal/telegram-target", headers=worker)).status_code == 404
    assert (await c.post("/api/internal/telegram", headers=worker, json={})).status_code == 404


async def test_reports_endpoint_lists_scheduled_assistant_rows(web, store):
    c, _ = web
    api = {"Authorization": "Bearer api-secret"}
    # Anonymous callers are rejected by the shared session guard.
    assert (await c.get("/api/reports")).status_code == 401
    await store.message("job:morning:2026-10-01:reply", "scheduled", "assistant", "Morning")
    await store.message("job:evening:2026-10-01:reply", "scheduled", "assistant", "Evening")
    await store.message("job:morning:2026-10-01:user", "scheduled", "user", "prompt")
    await store.message("web:x:reply", "web", "assistant", "chat reply")
    rows = (await c.get("/api/reports", headers=api)).json()["reports"]
    assert [r["kind"] for r in rows] == ["evening", "morning"]  # newest first by id
    assert {r["content"] for r in rows} == {"Evening", "Morning"}
    # Limit must stay within 1..100.
    assert (await c.get("/api/reports?limit=0", headers=api)).status_code == 422
    assert (await c.get("/api/reports?limit=101", headers=api)).status_code == 422
    assert (await c.get("/api/reports?limit=1", headers=api)).json()["reports"] == [rows[0]]


async def test_generic_health_checks_database_readiness(web, monkeypatch):
    c, app = web

    async def unavailable(*args, **kwargs):
        raise RuntimeError("private database details")

    monkeypatch.setattr(app.state.store, "query", unavailable)
    response = await c.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"ready": False}
