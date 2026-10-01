"""Session-issued Telegram capabilities and the authoritative delivery target."""

import asyncio
import re
import secrets
from datetime import UTC, datetime
from time import monotonic

from coach.auth import digest
from coach.tools import ToolError


def private_sender(message):
    chat, sender = message.get("chat"), message.get("from")
    if (
        not isinstance(chat, dict)
        or not isinstance(sender, dict)
        or chat.get("type") != "private"
        or type(chat.get("id")) is not int
        or chat["id"] <= 0
        or type(sender.get("id")) is not int
        or sender["id"] != chat["id"]
        or sender.get("is_bot") is not False
    ):
        raise ToolError("Telegram chat not allowed", 403)
    return str(chat["id"])


class TelegramLink:
    def __init__(self, cfg, store, client):
        self.cfg, self.store, self.client = cfg, store, client
        self._identity = None
        self._identity_until = 0
        self._identity_lock = asyncio.Lock()

    async def identity(self):
        """Lazy, mockable getMe; never infer recipient validity from config presence."""
        async with self._identity_lock:
            if self._identity and monotonic() < self._identity_until:
                return self._identity
            token = self.cfg.telegram_bot_token.get_secret_value()
            if not token:
                raise ToolError("Telegram bot is unavailable", 503)
            try:
                response = await self.client.post(
                    f"https://api.telegram.org/bot{token}/getMe", timeout=10
                )
                data = response.json()
                bot = data["result"]
                if (
                    not response.is_success
                    or data.get("ok") is not True
                    or bot.get("is_bot") is not True
                    or type(bot.get("id")) is not int
                    or bot["id"] <= 0
                    or not isinstance(bot.get("username"), str)
                    or not re.fullmatch(r"[A-Za-z0-9_]+", bot["username"])
                ):
                    raise ValueError
            except Exception:
                raise ToolError("Telegram bot is unavailable", 503) from None
            self._identity = {"id": bot["id"], "username": bot["username"]}
            self._identity_until = monotonic() + 300
            return self._identity

    async def target(self):
        # Provider outages must stay retryable. Returning None here would make
        # relays mistake authorized messages for an unlinked chat and discard them.
        bot = await self.identity()
        row = await self.store.query("SELECT chat_id,bot_id FROM telegram_link WHERE id=1", one=True)
        if row["chat_id"] is not None:
            target = row["chat_id"] if row["bot_id"] == str(bot["id"]) else None
        else:
            target = self.cfg.telegram_chat_id
        if not target or not re.fullmatch(r"[1-9][0-9]*", target) or target == str(bot["id"]):
            return None
        return target

    async def status(self):
        target = await self.target()
        result = {
            "connected": target is not None,
            "bot_username": self._identity["username"] if self._identity else "coachreachybot",
        }
        if target is not None:
            result["chat_id"] = target
        return result

    async def issue(self):
        bot = await self.identity()
        token = secrets.token_urlsafe(24)  # 192 bits, exactly 32 URL-safe characters.
        row = await self.store.query(
            "UPDATE telegram_link SET pairing_token_hash=%s, "
            "pairing_expires_at=now()+interval '10 minutes' WHERE id=1 RETURNING pairing_expires_at",
            (digest(token),), one=True,
        )
        return {
            "url": f"https://t.me/{bot['username']}?start={token}",
            "expires_at": row["pairing_expires_at"].isoformat(),
        }

    async def consume(self, token, message, update_id):
        chat_id = private_sender(message)
        if not re.fullmatch(r"[A-Za-z0-9_-]{32}", token):
            raise ToolError("Invalid or expired Telegram pairing", 403)
        bot = await self.identity()
        if chat_id == str(bot["id"]):
            raise ToolError("Telegram chat not allowed", 403)
        async with self.store.pool.connection() as conn, conn.transaction():
            row = await self.store.query(
                "SELECT pairing_token_hash, pairing_expires_at "
                "FROM telegram_link WHERE id=1 FOR UPDATE", conn=conn, one=True,
            )
            if (
                not row["pairing_expires_at"]
                or row["pairing_expires_at"] <= datetime.now(UTC)
                or row["pairing_token_hash"] != digest(token)
            ):
                raise ToolError("Invalid or expired Telegram pairing", 403)
            await conn.execute(
                "UPDATE telegram_link SET chat_id=%s,bot_id=%s,linked_at=now(), "
                "pairing_token_hash=NULL,pairing_expires_at=NULL WHERE id=1",
                (chat_id, str(bot["id"])),
            )
            await self.store.enqueue(
                f"telegram-welcome:{update_id}", "notification",
                {"text": "Telegram is now linked to Coach Reachy. You can message your coach here."},
                conn=conn,
            )
            # Previously waiting notifications can now retry without a long backoff.
            await conn.execute(
                "UPDATE work_items SET available_at=now() WHERE kind='notification' AND status='retry'"
            )
        return {"status": "paired"}
