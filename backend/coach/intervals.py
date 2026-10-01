import asyncio
import re

import httpx


class UpstreamError(Exception):
    def __init__(self, status=502):
        self.status = status
        super().__init__(f"Intervals request failed ({status})")


def scrub(value):
    """Preserve raw records except credentials accidentally included upstream."""
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, dict):
        return {
            k: scrub(v)
            for k, v in value.items()
            if not any(
                s in k.lower()
                for s in ("token", "secret", "password", "api_key", "authorization", "cookie")
            )
        }
    return value


class Intervals:
    def __init__(self, api_key, athlete_id, client: httpx.AsyncClient, retry_delay=0.5):
        if athlete_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", athlete_id):
            raise ValueError("invalid athlete identifier")
        self.auth = httpx.BasicAuth("API_KEY", api_key)
        self.athlete_id, self.client, self.retry_delay = athlete_id, client, retry_delay
        self.configured = bool(api_key and athlete_id)

    async def request(self, method, path, *, json=None, params=None, activity=False):
        if not self.configured:
            raise UpstreamError(503)
        # Paths only originate from validated identifiers and application constants.
        prefix = "" if activity else f"athlete/{self.athlete_id}/"
        url = f"https://intervals.icu/api/v1/{prefix}{path}"
        attempts = 3 if method == "GET" else 1
        for attempt in range(attempts):
            try:
                response = await self.client.request(
                    method,
                    url,
                    auth=self.auth,
                    json=json,
                    params=params,
                    headers={"User-Agent": "CoachReachy/1.0"},
                    timeout=30,
                    follow_redirects=False,
                )
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == attempts - 1:
                    raise UpstreamError(502) from None
                await asyncio.sleep(self.retry_delay * 2**attempt)
                continue
            if response.status_code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                retry = response.headers.get("Retry-After", "")
                delay = min(float(retry), 10) if retry.isdigit() else self.retry_delay * 2**attempt
                await asyncio.sleep(delay)
                continue
            if not response.is_success:
                raise UpstreamError(response.status_code)
            if response.status_code == 204 or not response.content:
                return {}
            try:
                return scrub(response.json())
            except ValueError:
                raise UpstreamError(502) from None
        raise UpstreamError(502)

    async def collection(self, path, **params):
        data = await self.request("GET", path, params=params)
        if not isinstance(data, list) or any(
            not isinstance(row, dict) or "id" not in row for row in data
        ):
            raise UpstreamError(502)
        return data

    async def activities(self, oldest, newest):
        return await self.collection("activities", oldest=str(oldest), newest=f"{newest}T23:59:59")

    async def wellness(self, oldest, newest):
        return await self.collection("wellness", oldest=str(oldest), newest=str(newest))

    async def events_range(self, oldest, newest):
        return await self.collection("events", oldest=str(oldest), newest=str(newest))

    async def settings(self):
        # The athlete profile contains credentials; never fetch it for settings.
        return await self.collection("sport-settings")

    async def activity(self, id):
        return await self.request("GET", f"activity/{id}", activity=True)

    async def intervals(self, id):
        return await self.request("GET", f"activity/{id}/intervals", activity=True)

    async def streams(self, id):
        return await self.request("GET", f"activity/{id}/streams", activity=True)

    async def curves(self, sport, period):
        kind = "pace" if sport in ("Run", "TrailRun", "VirtualRun", "Swim") else "power"
        return await self.request(
            "GET", f"{kind}-curves", params={"type": sport, "curves": f"{period}d"}
        )

    async def event(self, id):
        return await self.request("GET", f"events/{id}")
