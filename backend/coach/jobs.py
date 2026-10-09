import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from coach.models import JobInput

PROMPTS = {
    "morning": "Morning check: today's HRV, sleep, resting HR and planned workout. Assess whether to proceed or suggest an adjustment, without making changes.",
    "evening": "Evening report: today's load, recovery and tomorrow's planned session. Missing data must be stated, not estimated.",
    "activity": "Post-workout review: compare planned versus done and measured interval pace against targets where present, then one improvement. State missing detail honestly.",
}


class Jobs:
    def __init__(self, cfg, store, tools, agent):
        self.cfg, self.store, self.tools, self.agent = cfg, store, tools, agent
        self.wakeup = asyncio.Event()

    async def accept_job(self, values):
        job = JobInput.model_validate(values)
        key = f"job:{job.kind}:{job.key}"
        await self.store.enqueue(key, "job", job.model_dump(mode="json", exclude_none=True))
        self.wakeup.set()
        return {"status": "accepted", "key": key}

    async def process(self, key):
        async def handler(key, payload):
            row = await self.store.work_status(key)
            if row["kind"] == "write":
                return await self.tools.execute_write(payload["operation_id"])
            if row["kind"] == "whoop_sync":
                return await self.whoop.sync()
            if row["kind"] == "sync":
                result = await self.tools.sync.run()
                return {
                    k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in result.items()
                }
            # A scheduled job (kind == "job") stores a read-only report; nothing is pushed out.
            kind = payload.get("kind")
            if kind not in PROMPTS:
                # Unknown scheduled kinds are acknowledged, not retried forever.
                return {"status": "ignored", "kind": kind}
            # Never generate advice from a stale wake-up cache. A failed sync is retried.
            await self.tools.sync.run()
            extra = (
                await self.tools.call("get_activity_analysis", {"id": payload["activity_id"]})
                if kind == "activity"
                else None
            )
            await self.agent.respond(
                PROMPTS[kind], key=key, channel="scheduled", read_only=True, extra=extra
            )
            return {"status": "stored", "kind": kind}

        return await self.store.process(key, handler)

    async def loop(self):
        while True:
            try:
                for row in await self.store.due_work():
                    await self.process(row["key"])
                # On wake and at most every configured interval, enqueue a durable sync.
                now = datetime.now(ZoneInfo("Europe/Amsterdam"))
                slot = int(now.timestamp()) // self.cfg.sync_interval_seconds
                await self.store.enqueue(f"sync:{slot}", "sync", {})
                if getattr(self, "whoop", None) and self.whoop.configured:
                    await self.store.enqueue(
                        f"whoop-sync:{int(now.timestamp()) // 1200}", "whoop_sync", {}
                    )
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
