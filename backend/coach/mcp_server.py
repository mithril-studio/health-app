import hashlib
import json
from urllib.parse import urlsplit

from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.transport_security import TransportSecuritySettings

from coach.auth import mcp_capability
from coach.models import READ_TOOLS, TOOL_DESCRIPTIONS, TOOL_MODELS
from coach.tools import ToolError
from coach.workout import coach_result


def create_mcp(service, settings):
    async def list_tools(context, params):
        capability = mcp_capability.get()
        names = READ_TOOLS if capability and capability["read_only"] else TOOL_MODELS
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=name,
                    description=TOOL_DESCRIPTIONS[name],
                    inputSchema=TOOL_MODELS[name].model_json_schema(),
                    annotations=types.ToolAnnotations(
                        readOnlyHint=name in READ_TOOLS, destructiveHint=name not in READ_TOOLS
                    ),
                )
                for name in sorted(names)
            ]
        )

    async def call_tool(context, params):
        capability = mcp_capability.get()
        name, args = params.name, params.arguments or {}
        read_only, operation_key = False, None
        try:
            if capability:
                row = await service.store.query(
                    "UPDATE agent_capabilities SET used=used+1 WHERE token_hash=%s AND used<budget AND expires_at>now() RETURNING *",
                    (capability["token_hash"],),
                    one=True,
                )
                if not row:
                    raise ToolError("Agent tool budget exhausted", 429)
                read_only = row["read_only"]
                canonical = json.dumps([name, args], sort_keys=True)
                operation_key = (
                    row["operation_prefix"] + ":" + hashlib.sha256(canonical.encode()).hexdigest()
                )
            # Pass the original JSON to strict validation, with no SDK argument coercion.
            result = await service.call(
                name, args, read_only=read_only, operation_key=operation_key
            )
            if capability:
                result = coach_result(name, result)
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=json.dumps(result, default=str))]
            )
        except (ValueError, ToolError):
            text = "Tool input or permission rejected; review the schema and user permissions."
        except Exception:
            text = "Upstream data or service unavailable; no metrics may be inferred."
        return types.CallToolResult(
            isError=True, content=[types.TextContent(type="text", text=text)]
        )

    server = Server(
        "Coach Reachy",
        instructions="Use cached Intervals data. Missing data is unknown. Deletes require web user confirmation.",
        on_list_tools=list_tools,
        on_call_tool=call_tool,
    )
    origin = urlsplit(settings.app_origin)
    return server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[origin.netloc, "localhost:*", "127.0.0.1:*"],
            allowed_origins=[settings.app_origin],
        ),
    )
