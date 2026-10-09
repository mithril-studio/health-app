import json
from datetime import date

import pytest
from test_guards import web


@pytest.mark.asyncio
async def test_mcp_public_endpoint_initializes_without_redirect(web):
    client, _ = web
    response = await client.post(
        "/mcp",
        headers={
            "Authorization": "Bearer mcp-secret",
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "contract-test", "version": "1.0"},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["serverInfo"]["name"] == "Coach Reachy"


@pytest.mark.asyncio
async def test_cli_capability_has_only_read_tools_for_scheduled_advice(web):
    client, app = web
    token = await app.state.auth.issue_capability("scheduled-test", True, 2)
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json, text/event-stream"}
    response = await client.post(
        "/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    )
    assert response.status_code == 200
    assert all(tool["name"].startswith("get_") for tool in response.json()["result"]["tools"])
    rejected = await client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "plan_workout",
                "arguments": {
                    "date": "2026-10-02",
                    "name": "Unauthorized plan",
                    "sport": "Run",
                    "description": "- 20m easy",
                },
            },
        },
    )
    assert rejected.json()["result"]["isError"] is True
    assert not await app.state.store.query("SELECT * FROM write_operations")


async def test_scoped_mcp_receives_compact_full_workout_analysis(web):
    from test_workout import activity, streams

    client, app = web
    store = app.state.store
    a = activity() | {"unused": "x" * 100000}
    await store.put("activity_intervals", "run", a.pop("intervals"))
    await store.put("activities", "run", a, date(2026, 10, 8))
    await store.put("activity_streams", "run", streams([0, 5, 10], [170, 160, 180]))
    token = await app.state.auth.issue_capability("analysis", True, 2)
    response = await client.post(
        "/mcp",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "get_activity_analysis",
                "arguments": {"id": "run"},
            },
        },
    )
    result = response.json()["result"]
    assert not result.get("isError")
    evidence = json.loads(result["content"][0]["text"])
    assert len(evidence["intervals"]) == 3
    assert evidence["session"]["above_lt2_seconds"] == 5
    assert len(result["content"][0]["text"]) < 20000
