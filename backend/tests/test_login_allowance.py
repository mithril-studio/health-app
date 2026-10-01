import asyncio

from test_guards import web  # noqa: F401


async def test_successful_logins_do_not_exhaust_password_failure_allowance(web):
    client, _ = web
    for _ in range(8):
        response = await client.post(
            "/api/login",
            headers={"Origin": "https://coach.test"},
            json={"password": "correct-password"},
        )
        assert response.status_code == 200


async def test_successful_login_resets_prior_failures(web):
    client, _ = web
    for _ in range(2):
        for _ in range(4):
            response = await client.post(
                "/api/login", headers={"Origin": "https://coach.test"}, json={"password": "wrong"}
            )
            assert response.status_code == 401
        response = await client.post(
            "/api/login",
            headers={"Origin": "https://coach.test"},
            json={"password": "correct-password"},
        )
        assert response.status_code == 200


async def test_concurrent_failures_are_limited_and_expiry_allows_login(web, store):
    client, _ = web
    responses = await asyncio.gather(
        *[
            client.post(
                "/api/login", headers={"Origin": "https://coach.test"}, json={"password": "wrong"}
            )
            for _ in range(8)
        ]
    )
    assert sorted(r.status_code for r in responses) == [401] * 5 + [429] * 3
    blocked = await client.post(
        "/api/login",
        headers={"Origin": "https://coach.test"},
        json={"password": "correct-password"},
    )
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["retry-after"]) <= 900
    await store.execute(
        "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE bucket LIKE %s",
        ("login:%",),
    )
    assert (
        await client.post(
            "/api/login",
            headers={"Origin": "https://coach.test"},
            json={"password": "correct-password"},
        )
    ).status_code == 200
