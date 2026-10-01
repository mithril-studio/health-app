import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from coach.models import JobInput
from coach.telegram_link import TelegramLink, private_sender
from coach.tools import ToolError


def notification_chunks(text):
    chunks, current, size = [], [], 0
    for char in text:
        units = len(char.encode("utf-16-le")) // 2
        if size + units > 4000:
            chunks.append("".join(current))
            current, size = [], 0
        current.append(char)
        size += units
    if current:
        chunks.append("".join(current))
    return chunks


class Jobs:
    def __init__(self, cfg, store, tools, agent, client, *, telegram_link=None):
        self.cfg, self.store, self.tools, self.agent, self.client = cfg, store, tools, agent, client
        self.telegram_link = telegram_link or TelegramLink(cfg, store, client)
        self.wakeup = asyncio.Event()

    async def accept_telegram(self, update):
        if (
            not isinstance(update, dict)
            or type(update.get("update_id")) is not int
            or update["update_id"] < 0
        ):
            raise ToolError("Invalid Telegram update", 422)
        message = update.get("message")
        if not isinstance(message, dict):
            return {"status": "ignored", "reason": "Only new text messages are supported"}
        chat_id = private_sender(message)
        text = message.get("text")
        if isinstance(text, str) and text.startswith("/start "):
            result = await self.telegram_link.consume(text[7:], message, update["update_id"])
            self.wakeup.set()
            return result
        if chat_id != await self.telegram_link.target():
            raise ToolError("Telegram chat not allowed", 403)
        if not isinstance(text, str) or not text.strip():
            return {"status": "ignored", "reason": "Text message required"}
        if len(text) > 8000:
            raise ToolError("Telegram message too long", 422)
        key = f"telegram:{update['update_id']}"
        await self.store.enqueue(key, "telegram", {"text": text, "chat_id": chat_id})
        self.wakeup.set()
        return {"status": "accepted", "key": key}

    async def accept_job(self, values):
        job = JobInput.model_validate(values)
        key = f"job:{job.kind}:{job.key}"
        await self.store.enqueue(key, "job", job.model_dump(mode="json", exclude_none=True))
        self.wakeup.set()
        return {"status": "accepted", "key": key}

    async def process(self, key):
        async def handler(key, payload):
            row = await self.store.work_status(key)
            if row["kind"] == "notification":
                await self.send_notification(key, payload["text"])
                return {"delivered": True}
            if row["kind"] == "write":
                return await self.tools.execute_write(payload["operation_id"])
            if row["kind"] == "sync":
                result = await self.tools.sync.run()
                return {
                    k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in result.items()
                }
            if row["kind"] == "telegram":
                target = await self.telegram_link.target()
                if target is None:
                    raise ToolError("Telegram must be linked", 503)
                if payload.get("chat_id") != target:
                    return {"status": "ignored"}
            # Never generate advice from a stale wake-up cache. A failed sync is retried.
            await self.tools.sync.run()
            if row["kind"] == "telegram":
                # Sync can be slow; a relink during it revokes the old sender too.
                if payload["chat_id"] != await self.telegram_link.target():
                    return {"status": "ignored"}
                reply = await self.agent.respond(payload["text"], key=key, channel="telegram")
            else:
                kind = payload["kind"]
                prompts = {
                    "morning": "Morning check: today's HRV, sleep, resting HR and planned workout. Assess whether to proceed or suggest an adjustment, without making changes.",
                    "evening": "Evening report: today's load, recovery and tomorrow's planned session. Missing data must be stated, not estimated.",
                    "activity": "Post-workout review: compare planned versus done and measured interval pace against targets where present, then one improvement. State missing detail honestly.",
                }
                extra = (
                    await self.tools.call("get_activity", {"id": payload["activity_id"]})
                    if kind == "activity"
                    else None
                )
                reply = await self.agent.respond(
                    prompts[kind], key=key, channel="scheduled", read_only=True, extra=extra
                )
            # Durable outbox: a generated reply remains queued even if Telegram is down.
            await self.store.enqueue("reply:" + key, "notification", {"text": reply})
            return {"notification_key": "reply:" + key}

        return await self.store.process(key, handler)

    async def send_notification(self, key, text):
        for part, chunk in enumerate(notification_chunks(text)):
            if await self.store.query(
                "SELECT 1 FROM notification_parts WHERE work_key=%s AND part=%s",
                (key, part),
                one=True,
            ):
                continue
            target = await self.telegram_link.target()
            if target is None or not self.cfg.telegram_bot_token.get_secret_value():
                raise ToolError("Telegram must be linked", 503)
            try:
                response = await self.client.post(
                    "https://api.telegram.org/bot"
                    + self.cfg.telegram_bot_token.get_secret_value()
                    + "/sendMessage",
                    json={
                        "chat_id": target,
                        "text": chunk,
                        "link_preview_options": {"is_disabled": True},
                    },
                    timeout=20,
                )
                if not response.is_success or response.json().get("ok") is not True:
                    raise ToolError("Telegram delivery failed", 503)
            except Exception:
                raise ToolError("Telegram delivery failed", 503) from None
            # Telegram lacks idempotency keys. Crash between remote send and this commit
            # can duplicate one part; at-least-once delivery is preferable to a lost echo.
            await self.store.execute(
                "INSERT INTO notification_parts(work_key,part) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (key, part),
            )

    async def loop(self):
        while True:
            try:
                for row in await self.store.due_work():
                    await self.process(row["key"])
                # On wake and at most every configured interval, enqueue a durable sync.
                now = datetime.now(ZoneInfo("Europe/Amsterdam"))
                slot = int(now.timestamp()) // self.cfg.sync_interval_seconds
                await self.store.enqueue(f"sync:{slot}", "sync", {})
                self.wakeup.clear()
                try:
                    await asyncio.wait_for(self.wakeup.wait(), timeout=5)
                except TimeoutError:
                    pass
            except asyncio.CancelledError:
                raise
            except Exception:
                # Rows stay pending/running/retry and are recovered on the next pass.
                # Report only a constant event; never log exception URLs, bodies or data.
                import logging

                logging.getLogger("coach").warning("background_iteration_failed")
                await asyncio.sleep(5)
