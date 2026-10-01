"""Pure transformations; missing values are never filled with fabricated metrics."""

from collections import defaultdict
from datetime import date, timedelta
from math import isfinite


def number(value):
    return (
        value
        if isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value)
        else None
    )


def fitness_from_wellness(rows):
    result = []
    for row in rows:
        ctl, atl = number(row.get("ctl")), number(row.get("atl"))
        result.append(
            {
                "date": row["id"],
                "ctl": ctl,
                "atl": atl,
                "form": ctl - atl if ctl is not None and atl is not None else None,
            }
        )
    return result


def zone_seconds(values):
    result = {}
    for index, item in enumerate(values or []):
        key, value = (
            (item.get("id", f"Z{index + 1}"), item.get("secs"))
            if isinstance(item, dict)
            else (f"Z{index + 1}", item)
        )
        if number(value) is not None:
            result[str(key)] = value
    return result


def insights(activities, wellness, settings):
    weekly, zones = {}, {}
    thresholds = []
    for row in activities:
        if not row.get("start_date_local"):
            continue
        day = date.fromisoformat(row["start_date_local"][:10])
        week = str(day - timedelta(days=day.weekday()))
        sport = row.get("type") or "Unknown"
        key = (week, sport)
        agg = weekly.setdefault(
            key,
            {
                "week": week,
                "sport": sport,
                "count": 0,
                "load": None,
                "moving_time": None,
                "distance": None,
                "missing_load": 0,
            },
        )
        agg["count"] += 1
        for source, dest in [
            ("icu_training_load", "load"),
            ("moving_time", "moving_time"),
            ("distance", "distance"),
        ]:
            value = number(row.get(source))
            if value is not None:
                agg[dest] = (agg[dest] or 0) + value
            elif dest == "load":
                agg["missing_load"] += 1
        z = zones.setdefault(
            key,
            {
                "week": week,
                "sport": sport,
                "power": defaultdict(float),
                "hr": defaultdict(float),
                "pace": defaultdict(float),
            },
        )
        for source, dest in [
            ("icu_zone_times", "power"),
            ("hr_zone_times", "hr"),
            ("pace_zone_times", "pace"),
        ]:
            for zone, secs in zone_seconds(row.get(source)).items():
                z[dest][zone] += secs
        pace = number(row.get("icu_threshold_pace"))
        if sport in ("Run", "VirtualRun", "TrailRun") and pace:
            thresholds.append({"date": str(day), "metres_per_second": pace})
    return {
        "weekly_load": [weekly[k] for k in sorted(weekly)],
        "time_in_zones": [zones[k] for k in sorted(zones)],
        "recovery": wellness,
        "goals": {
            "targets_seconds": [1080, 1020],
            "best_5k_seconds": None,
            "threshold_pace_history": thresholds,
            "note": "Exact 5 km best efforts require pace curves; no whole-run estimate.",
        },
    }
