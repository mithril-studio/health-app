import httpx
import pytest

from coach.intervals import Intervals, UpstreamError, scrub


async def test_read_retries_and_uses_basic_auth_and_safe_errors():
    calls = []

    async def transport(req):
        calls.append(req)
        if len(calls) == 1:
            return httpx.Response(503, text="private upstream detail")
        return httpx.Response(200, json=[{"id": "x"}])

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        source = Intervals("fake-secret", "athlete", client, retry_delay=0)
        assert await source.settings() == [{"id": "x"}]
        assert len(calls) == 2 and calls[0].headers["authorization"].startswith("Basic ")
        assert calls[0].url.host == "intervals.icu"


async def test_mutation_not_blindly_retried_and_upstream_message_not_exposed():
    calls = []

    async def transport(req):
        calls.append(req)
        return httpx.Response(500, text="fake-secret and sensitive metrics")

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        source = Intervals("fake-secret", "athlete", client, retry_delay=0)
        with pytest.raises(UpstreamError) as err:
            await source.request("POST", "events", json={})
        assert "fake-secret" not in str(err.value) and len(calls) == 1


def test_scrub_removes_credential_fields_recursively():
    assert scrub({"icu_api_key": "private", "id": "a", "rows": [{"token": "x", "ctl": 30}]}) == {
        "id": "a",
        "rows": [{"ctl": 30}],
    }
