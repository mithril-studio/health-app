import hashlib
import hmac
import secrets
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie

from starlette.responses import JSONResponse

COOKIE = "__Host-coach_session"
mcp_capability = ContextVar("mcp_capability", default=None)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def matches(actual, expected):
    return bool(expected) and hmac.compare_digest(actual.encode(), expected.encode())


class Auth:
    def __init__(self, settings, store):
        self.cfg, self.store = settings, store

    async def rate(self, key, limit, seconds):
        row = await self.store.query(
            """INSERT INTO rate_limits(bucket,count,expires_at)
            VALUES (%s,1,now()+%s) ON CONFLICT(bucket) DO UPDATE SET
            count=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.count+1 END,
            expires_at=CASE WHEN rate_limits.expires_at<=now() THEN excluded.expires_at ELSE rate_limits.expires_at END
            RETURNING count""",
            (key, timedelta(seconds=seconds)),
            one=True,
        )
        return row["count"] <= limit

    async def session_valid(self, token):
        if not token:
            return False
        return bool(
            await self.store.query(
                "SELECT 1 FROM sessions WHERE token_hash=%s AND expires_at>now()",
                (digest(token),),
                one=True,
            )
        )

    async def login(self, password, previous=None):
        if not matches(password, self.cfg.app_password.get_secret_value()):
            return None
        token = secrets.token_urlsafe(32)
        async with self.store.pool.connection() as conn, conn.transaction():
            if previous:
                await conn.execute("DELETE FROM sessions WHERE token_hash=%s", (digest(previous),))
            await conn.execute(
                "INSERT INTO sessions VALUES (%s,%s)",
                (digest(token), datetime.now(UTC) + timedelta(days=7)),
            )
        return token

    async def issue_capability(self, prefix, read_only, budget):
        token = secrets.token_urlsafe(32)
        await self.store.execute(
            "INSERT INTO agent_capabilities(token_hash,operation_prefix,read_only,budget,expires_at) VALUES (%s,%s,%s,%s,now()+interval '5 minutes')",
            (digest(token), prefix, read_only, budget),
        )
        return token

    async def capability(self, token):
        return await self.store.query(
            "SELECT * FROM agent_capabilities WHERE token_hash=%s AND expires_at>now()",
            (digest(token),),
            one=True,
        )


class Guard:
    """ASGI guard also protects MCP mount, before parsing user bodies."""

    def __init__(self, app, auth):
        self.app, self.auth = app, auth

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        origin = headers.get("origin")
        mutation = scope["method"] not in ("GET", "HEAD", "OPTIONS")
        bearer = headers.get("authorization", "")
        bearer = bearer[7:] if bearer.startswith("Bearer ") else ""
        cfg = self.auth.cfg

        async def reject(status, detail):
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

        # Require the explicitly configured origin, never untrusted forwarded headers.
        if origin and origin != cfg.app_origin:
            return await reject(403, "Origin not allowed")
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("cookie", ""))
            token = cookie[COOKIE].value if COOKIE in cookie else ""
        except Exception:
            token = ""
        capability = None
        if path == "/mcp" or path.startswith("/mcp/"):
            if not matches(bearer, cfg.mcp_auth_token.get_secret_value()):
                capability = await self.auth.capability(bearer) if bearer else None
                if not capability:
                    return await reject(401, "Unauthorized")
            principal = "mcp"
        elif path.startswith("/api/internal/"):
            if not matches(bearer, cfg.box_shared_secret.get_secret_value()):
                return await reject(401, "Unauthorized")
            principal = "worker"
        elif path in ("/api/login", "/api/session", "/api/health"):
            principal = "public"
            if path == "/api/login" and origin != cfg.app_origin:
                return await reject(403, "Origin required")
        elif path.startswith("/api/"):
            if matches(bearer, cfg.api_auth_token.get_secret_value()):
                principal = "api"
            elif await self.auth.session_valid(token):
                principal = "session"
            else:
                return await reject(401, "Unauthorized")
            if path.startswith("/api/confirmations") and principal != "session":
                return await reject(403, "Confirmation requires a user session")
            if mutation and principal == "session" and origin != cfg.app_origin:
                return await reject(403, "Origin required")
        else:
            return await reject(404, "Not found")
        if path != "/api/health":
            # Proxy headers are not trusted here. Deploy uvicorn with trusted nginx proxy
            # addresses only; request.client is then the verified client address.
            ip = str((scope.get("client") or ("unknown",))[0])
            identity = hmac.new(
                cfg.app_password.get_secret_value().encode(), ip.encode(), hashlib.sha256
            ).hexdigest()
            limit, window = (5, 900) if path == "/api/login" else (180, 60)
            bucket = ("login:" if path == "/api/login" else principal + ":") + identity
            if not await self.auth.rate(bucket, limit, window):
                return await reject(429, "Rate limit exceeded")
        scope.setdefault("state", {})["principal"] = principal
        scope["state"]["session_token"] = token
        # Bound JSON and MCP request memory, including chunked transfer encoding.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > 65536:
                return await reject(413, "Request too large")
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        used = False

        async def replay():
            nonlocal used
            if not used:
                used = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        async def secured_send(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-frame-options", b"DENY"),
                    ]
                )
            await send(message)

        context = mcp_capability.set(capability)
        try:
            await self.app(scope, replay, secured_send)
        finally:
            mcp_capability.reset(context)
