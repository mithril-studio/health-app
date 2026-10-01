from datetime import date, timedelta

from dateutil.relativedelta import relativedelta


def sync_window(today: date, last: date | None):
    backfill = today - relativedelta(months=12)
    return max(backfill, last - timedelta(days=7)) if last else backfill, today


class SyncService:
    def __init__(self, store, source):
        self.store, self.source = store, source

    async def run(self, today=None):
        import asyncio
        from datetime import datetime
        from zoneinfo import ZoneInfo

        from coach.analytics import fitness_from_wellness

        today = today or datetime.now(ZoneInfo("Europe/Amsterdam")).date()
        async with self.store.lock("sync", wait=True) as conn:
            state = await self.store.query(
                "SELECT cursor_date FROM sync_state WHERE resource='all'", conn=conn, one=True
            )
            oldest, newest = sync_window(today, state["cursor_date"] if state else None)
            # Refresh the complete retained event window, including future events, to remove
            # remote deletions and moves out of the incremental activity window.
            event_oldest, event_newest = (
                today - relativedelta(months=12),
                today + relativedelta(months=12),
            )
            try:
                activities, wellness, events, settings = await asyncio.gather(
                    self.source.activities(oldest, newest),
                    self.source.wellness(oldest, newest),
                    self.source.events_range(event_oldest, event_newest),
                    self.source.settings(),
                )
                async with conn.transaction():
                    for table, rows, start, end in [
                        ("activities", activities, oldest, newest),
                        ("wellness", wellness, oldest, newest),
                        ("fitness_daily", fitness_from_wellness(wellness), oldest, newest),
                        ("events", events, event_oldest, event_newest),
                    ]:
                        await self.store.replace_range(table, rows, start, end, conn)
                    # Invalidate lazy data only for activities whose source snapshot changed.
                    # Recent data is cheap to re-read and may gain laps after initial upload.
                    await conn.execute(
                        "DELETE FROM activity_intervals WHERE id IN (SELECT id FROM activities WHERE day BETWEEN %s AND %s)",
                        (oldest, newest),
                    )
                    await conn.execute(
                        "DELETE FROM activity_streams WHERE id IN (SELECT id FROM activities WHERE day BETWEEN %s AND %s)",
                        (oldest, newest),
                    )
                    await conn.execute("DELETE FROM sport_settings")
                    for item in settings:
                        await self.store.put("sport_settings", item["id"], item, conn=conn)
                    for resource in (
                        "activities",
                        "wellness",
                        "fitness_daily",
                        "events",
                        "sport_settings",
                        "all",
                    ):
                        await conn.execute(
                            "INSERT INTO sync_state(resource,cursor_date,last_success,error,oldest,newest) VALUES (%s,%s,now(),NULL,%s,%s) ON CONFLICT(resource) DO UPDATE SET cursor_date=excluded.cursor_date,last_success=excluded.last_success,error=NULL,newest=excluded.newest",
                            (resource, newest, oldest, newest),
                        )
            except Exception as exc:
                await conn.execute(
                    "INSERT INTO sync_state(resource,error) VALUES ('all',%s) ON CONFLICT(resource) DO UPDATE SET error=excluded.error",
                    (type(exc).__name__,),
                )
                raise
        return await self.store.sync_status()
