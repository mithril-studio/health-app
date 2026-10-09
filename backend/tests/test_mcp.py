import pytest
from test_guards import web

HEADERS = {
    "Authorization": "Bearer mcp-secret",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
}


async def rpc(c, method, params=None, headers=None):
    return await c.post(
        "/mcp",
        headers=headers or HEADERS,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )


async def test_stateless_mcp_initialize_list_call_and_strict_validation(web):
    c, app = web
    init = await rpc(
        c,
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    )
    assert init.status_code == 200, init.text
    assert "mcp-session-id" not in init.headers
    tools = (await rpc(c, "tools/list")).json()["result"]["tools"]
    assert len(tools) == 11 and "confirm_delete" not in [t["name"] for t in tools]
    assert {"get_activity_analysis", "get_training_summary"} <= {t["name"] for t in tools}
    assert all(t["inputSchema"]["additionalProperties"] is False for t in tools)
    result = await rpc(
        c,
        "tools/call",
        {"name": "get_calendar", "arguments": {"oldest": "2026-10-01", "newest": "2026-10-02"}},
    )
    assert result.status_code == 200 and not result.json()["result"].get("isError")
    invalid = await rpc(
        c, "tools/call", {"name": "delete_workout", "arguments": {"id": "21", "confirmed": True}}
    )
    assert invalid.json()["result"]["isError"] is True
    assert app.state.tools.source.calls == []


async def test_readonly_capability_enforced_at_server_and_budget_bounded(web, store):
    c, app = web
    token = await app.state.auth.issue_capability("scheduled-test", True, 2)
    headers = {**HEADERS, "Authorization": "Bearer " + token}
    tools = (await rpc(c, "tools/list", headers=headers)).json()["result"]["tools"]
    assert len(tools) == 7
    invalid = await rpc(
        c, "tools/call", {"name": "delete_workout", "arguments": {"id": "21"}}, headers
    )
    assert invalid.json()["result"]["isError"] is True
    for _ in range(2):
        r = await rpc(
            c,
            "tools/call",
            {"name": "get_calendar", "arguments": {"oldest": "2026-10-01", "newest": "2026-10-02"}},
            headers,
        )
    assert r.json()["result"]["isError"] is True
    assert await store.query("SELECT * FROM pending_deletions") == []


async def test_mcp_rejects_untrusted_browser_origins(web):
    c, _ = web
    assert (
        await rpc(c, "tools/list", headers={**HEADERS, "Origin": "https://evil.test"})
    ).status_code == 403
