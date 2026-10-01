import asyncio
import logging
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import httpx
from fastapi import Body, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from coach.agent import Agent, AgentUnavailable
from coach.analytics import insights
from coach.auth import COOKIE, Auth, Guard, LoginRateLimited, digest
from coach.config import Settings
from coach.db import Store
from coach.intervals import Intervals, UpstreamError
from coach.jobs import Jobs
from coach.mcp_server import create_mcp
from coach.models import (
    ActivityInput,
    ChatInput,
    ConversationId,
    CurvesInput,
    DateRange,
    JobInput,
    LoginInput,
)
from coach.telegram_link import TelegramLink
from coach.tools import ToolError, ToolService


def create_app(settings=None, *, store=None, source=None):
    cfg = settings or Settings()
    owns_store = store is None
    db = store or Store(cfg.database_url.get_secret_value())
    client = httpx.AsyncClient(follow_redirects=False, limits=httpx.Limits(max_connections=20))
    source = source or Intervals(
        cfg.intervals_api_key.get_secret_value(), cfg.intervals_athlete_id, client
    )
    auth = Auth(cfg, db)
    telegram_link = TelegramLink(cfg, db, client)
    tools = ToolService(db, source, telegram_link=telegram_link)
    agent = Agent(cfg, db, tools, client, auth)
    jobs = Jobs(cfg, db, tools, agent, client, telegram_link=telegram_link)
    mcp = create_mcp(tools, cfg)
    # Network libraries can log request URLs containing the Telegram bot token.
    for logger in ("httpx", "httpcore", "mcp", "psycopg.pool"):
        logging.getLogger(logger).setLevel(logging.CRITICAL)

    @asynccontextmanager
    async def lifespan(app):
        app.state.ready = False
        if owns_store:
            await db.open()
        await db.migrate()
        task = None
        try:
            async with mcp.router.lifespan_context(mcp):
                app.state.ready = True
                if cfg.background_enabled:
                    task = asyncio.create_task(jobs.loop())
                yield
        finally:
            app.state.ready = False
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            await client.aclose()
            if owns_store:
                await db.close()

    app = FastAPI(
        title="Coach Reachy", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.ready = False
    app.state.store, app.state.tools, app.state.jobs = db, tools, jobs
    app.state.agent, app.state.auth, app.state.settings = agent, auth, cfg
    app.state.telegram_link = telegram_link
    app.add_middleware(Guard, auth=auth)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def invalid(request, exc):
        # Pydantic's default payload reflects submitted passwords/tokens back to clients.
        return JSONResponse({"detail": "Invalid request arguments"}, status_code=422)

    @app.exception_handler(ToolError)
    async def tool_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.exception_handler(UpstreamError)
    async def upstream_error(request, exc):
        return JSONResponse(
            {"detail": "Intervals is unavailable or rejected the request"}, status_code=502
        )

    @app.exception_handler(AgentUnavailable)
    async def agent_error(request, exc):
        return JSONResponse(
            {"detail": str(exc), "configured": agent.status()["configured"]}, status_code=503
        )

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({"detail": "Invalid or conflicting request"}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        return JSONResponse({"detail": "Service temporarily unavailable"}, status_code=503)

    async def wake():
        # A first successful UI read may render empty cache while durable initial sync runs.
        # Subsequent reads are always cache-first and never wait for an external fetch.
        if cfg.background_enabled:
            slot = int(datetime.now().timestamp()) // cfg.sync_interval_seconds
            await db.enqueue(f"sync:{slot}", "sync", {})
            jobs.wakeup.set()

    @app.get("/api/health")
    async def health():
        ready = app.state.ready
        try:
            async with asyncio.timeout(2):
                await db.query("SELECT 1", one=True)
        except Exception:
            ready = False
        return JSONResponse({"ready": ready}, status_code=200 if ready else 503)

    @app.get("/api/session")
    async def session(request: Request):
        token = request.state.session_token
        authenticated = await auth.session_valid(token)
        # Status only: never log cookie values, credentials, or request headers.
        logging.getLogger("uvicorn.error").info(
            "Browser session check: %s",
            "valid" if authenticated else "unknown-session" if token else "missing-cookie",
        )
        return {"authenticated": authenticated, "cookie_received": bool(token)}

    @app.post("/api/login")
    async def login(body: LoginInput, request: Request):
        try:
            token = await auth.login(
                body.password, request.state.session_token, rate_key=request.state.login_bucket
            )
        except LoginRateLimited as exc:
            return JSONResponse(
                {
                    "detail": "Too many incorrect password attempts. Please wait before trying again."
                },
                status_code=429,
                headers={"Retry-After": str(exc.retry_after)},
            )
        if token is None:
            raise ToolError("Invalid password", 401)
        response = JSONResponse({"authenticated": True})
        response.set_cookie(
            COOKIE,
            token,
            max_age=7 * 86400,
            secure=True,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return response

    @app.post("/api/logout")
    async def logout(request: Request):
        await db.execute(
            "DELETE FROM sessions WHERE token_hash=%s", (digest(request.state.session_token),)
        )
        response = JSONResponse({"authenticated": False})
        response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
        return response

    @app.get("/api/dashboard")
    async def dashboard(oldest: date | None = None, newest: date | None = None):
        today = datetime.now(ZoneInfo("Europe/Amsterdam")).date()
        dates = DateRange(
            oldest=oldest or today - timedelta(days=28), newest=newest or today + timedelta(days=14)
        )
        await wake()
        activities = await db.range("activities", dates.oldest, dates.newest)
        events = await db.range("events", dates.oldest, dates.newest)
        wellness = await db.range("wellness", dates.oldest, dates.newest)
        fitness = await db.range("fitness_daily", dates.oldest, dates.newest)
        settings = await db.settings()
        data = insights(activities, wellness, settings)
        data["agent"] = agent.status()
        return {
            "activities": activities,
            "events": events,
            "wellness": wellness,
            "fitness": fitness,
            "settings": settings,
            "sync": await db.sync_status(),
            "insights": data,
        }

    @app.get("/api/activity/{id}")
    async def activity(id: str):
        return await tools.call("get_activity", ActivityInput(id=id).model_dump())

    @app.get("/api/activity/{id}/streams")
    async def streams(id: str):
        return await tools.activity(ActivityInput(id=id).id, streams=True)

    @app.get("/api/curves")
    async def curves(sport: str = "Run", period: int = 84):
        return await tools.call("get_curves", CurvesInput(sport=sport, period=period).model_dump())

    @app.post("/api/sync")
    async def sync():
        return await tools.sync.run()

    @app.get("/api/conversations")
    async def conversations():
        return {"conversations": await db.conversations()}

    @app.post("/api/conversations", status_code=201)
    async def new_conversation():
        return await db.create_conversation("web:" + uuid.uuid4().hex)

    async def require_conversation(identifier):
        if not await db.conversation_exists(identifier):
            raise ToolError("Conversation not found", 404)

    @app.get("/api/chat")
    async def chat_history(conversation_id: ConversationId = "web"):
        await require_conversation(conversation_id)
        return {"messages": await db.history(conversation_id), "agent": agent.status()}

    @app.post("/api/chat")
    async def chat(
        body: ChatInput, idempotency_key: Annotated[str | None, Header(max_length=200)] = None
    ):
        await require_conversation(body.conversation_id)
        await tools.sync.run()
        reply = await agent.respond(
            body.message,
            key="web:" + (idempotency_key or uuid.uuid4().hex),
            channel=body.conversation_id,
        )
        jobs.wakeup.set()
        return {"reply": reply}

    @app.post("/api/tools/{name}")
    async def tool(
        name: str,
        arguments: Annotated[dict, Body()],
        idempotency_key: Annotated[str | None, Header(max_length=200)] = None,
    ):
        result = await tools.call(
            name, arguments, operation_key="api:" + idempotency_key if idempotency_key else None
        )
        jobs.wakeup.set()
        return result

    @app.get("/api/confirmations")
    async def confirmations():
        return {"pending": await tools.pending_deletions()}

    @app.post("/api/confirmations/{token}/confirm")
    async def confirm(token: str):
        if len(token) > 100:
            raise ToolError("Invalid confirmation", 422)
        result = await tools.confirm_delete(token)
        jobs.wakeup.set()
        return result

    @app.get("/api/telegram")
    async def telegram_status(request: Request):
        if request.state.principal != "session":
            raise ToolError("Telegram pairing requires a user session", 403)
        return await telegram_link.status()

    @app.post("/api/telegram/pairing")
    async def telegram_pairing(request: Request):
        if request.state.principal != "session":
            raise ToolError("Telegram pairing requires a user session", 403)
        return await telegram_link.issue()

    @app.get("/api/internal/telegram-target")
    async def telegram_target():
        return {"chat_id": await telegram_link.target()}

    @app.post("/api/internal/telegram", status_code=202)
    async def telegram(update: Annotated[dict, Body()]):
        return await jobs.accept_telegram(update)

    @app.post("/api/internal/job", status_code=202)
    async def job(body: JobInput):
        return await jobs.accept_job(body.model_dump(mode="json", exclude_none=True))

    @app.get("/api/jobs")
    async def job_status():
        rows = await db.query(
            "SELECT key,kind,status,attempts,error,available_at,updated_at FROM work_items WHERE status<>'succeeded' ORDER BY updated_at DESC LIMIT 100"
        )
        return {"pending": rows, "agent": agent.status()}

    # SDK owns Streamable HTTP framing and session management. Its lifespan is explicitly
    # entered above because ASGI mounts don't run their own lifespan automatically.
    app.mount("/", mcp)
    return app


app = create_app()
