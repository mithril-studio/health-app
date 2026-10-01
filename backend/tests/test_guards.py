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


async def test_telegram_chat_lock_happens_before_queue(web, store):
    c, app = web
    r = await c.post(
        "/api/internal/telegram",
        headers={"Authorization": "Bearer worker-secret"},
        json={"update_id": 1, "message": {"chat": {"id": 999}, "text": "hello"}},
    )
    assert r.status_code == 403
    assert await store.query("SELECT * FROM work_items") == []


async def test_generic_health_checks_database_readiness(web, monkeypatch):
    c, app = web

    async def unavailable(*args, **kwargs):
        raise RuntimeError("private database details")

    monkeypatch.setattr(app.state.store, "query", unavailable)
    response = await c.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"ready": False}
