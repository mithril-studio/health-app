"""Read-only upstream probe. Prints status, schema keys and counts, never data values.

Run from backend: .venv/bin/python scripts/probe_intervals.py --env ../.env
An optional --database-url performs sync in a temporary, isolated local DB schema.
"""

import argparse
import asyncio
import json
import sys
import time
import uuid
from pathlib import Path

import httpx
import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime
from zoneinfo import ZoneInfo

from coach.config import Settings
from coach.db import Store
from coach.intervals import Intervals
from coach.sync import SyncService, sync_window


async def probe(args):
    cfg = Settings(_env_file=args.env)
    print(
        json.dumps(
            {
                "intervals_configured": cfg.intervals_configured,
                "anthropic_env_credential_present": bool(
                    cfg.anthropic_api_key.get_secret_value()
                    or cfg.anthropic_oauth_token.get_secret_value()
                ),
            }
        )
    )
    if not cfg.intervals_configured:
        return
    async with httpx.AsyncClient() as client:
        source = Intervals(
            cfg.intervals_api_key.get_secret_value(), cfg.intervals_athlete_id, client
        )
        today = datetime.now(ZoneInfo("Europe/Amsterdam")).date()
        oldest, newest = sync_window(today, None)
        for label, call in [
            ("activities", source.activities(oldest, newest)),
            ("wellness", source.wellness(oldest, newest)),
            ("events", source.events_range(oldest, newest)),
            ("settings", source.settings()),
            ("pace_curves", source.curves("Run", 84)),
            ("power_curves", source.curves("Ride", 84)),
        ]:
            result = await call
            sample = result[0] if isinstance(result, list) and result else result
            print(
                json.dumps(
                    {
                        "resource": label,
                        "shape": type(result).__name__,
                        "count": len(result),
                        "keys": sorted(sample) if isinstance(sample, dict) else [],
                        **(
                            {"restricted_count": sum(bool(x.get("_note")) for x in result)}
                            if label == "activities"
                            else {}
                        ),
                    }
                )
            )
        if args.database_url:
            # No application schema or other agent's database is changed by this probe.
            schema = "probe_" + uuid.uuid4().hex
            async with await psycopg.AsyncConnection.connect(
                args.database_url, autocommit=True
            ) as conn:
                await conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            db = Store(args.database_url, options=f"-c search_path={schema}")
            try:
                await db.open()
                await db.migrate()
                sync = SyncService(db, source)
                for mode in ("backfill", "incremental"):
                    start = time.monotonic()
                    await sync.run()
                    counts = {
                        name: (
                            await db.query(
                                sql.SQL("SELECT count(*) AS n FROM {}").format(
                                    sql.Identifier(name)
                                ),
                                one=True,
                            )
                        )["n"]
                        for name in (
                            "activities",
                            "events",
                            "wellness",
                            "fitness_daily",
                            "sport_settings",
                        )
                    }
                    print(
                        json.dumps(
                            {
                                "sync_mode": mode,
                                "seconds": round(time.monotonic() - start, 3),
                                "counts": counts,
                            }
                        )
                    )
            finally:
                await db.close()
                async with await psycopg.AsyncConnection.connect(
                    args.database_url, autocommit=True
                ) as conn:
                    await conn.execute(
                        sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema))
                    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="../.env")
    parser.add_argument("--database-url")
    try:
        asyncio.run(probe(parser.parse_args()))
    except Exception as exc:
        # Exception messages from transports can contain credentials in request URLs.
        print(json.dumps({"probe_error": type(exc).__name__}))
        raise SystemExit(1) from None
