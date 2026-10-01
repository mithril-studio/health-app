import httpx
import pytest

from coach.config import Settings
from coach.telegram_link import TelegramLink
from coach.tools import ToolError


@pytest.mark.asyncio
async def test_identity_outage_cannot_silently_discard_incoming_messages():
    async def unavailable(request):
        return httpx.Response(503, json={'ok': False})
    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as client:
        link = TelegramLink(Settings(telegram_bot_token='synthetic-test-token'), None, client)
        # Relays must retry a provider outage, not treat it as an unlinked chat
        # and advance the Telegram offset past an authorized user's message.
        with pytest.raises(ToolError) as exc:
            await link.target()
        assert exc.value.status == 503
