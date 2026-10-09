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


# Model-facing projections of cached Intervals records. Raw records stay in the cache and the
# dashboard API; the coach only needs the training-relevant fields, so a year fits in a reply.
ACTIVITY_FIELDS = (
    "id",
    "name",
    "type",
    "start_date_local",
    "moving_time",
    "elapsed_time",
    "distance",
    "total_elevation_gain",
    "average_speed",
    "average_heartrate",
    "max_heartrate",
    "icu_average_watts",
    "icu_training_load",
    "icu_intensity",
    "trimp",
    "icu_rpe",
    "feel",
    "source",
    "session_duration",
    "whoop_strain",
    "_note",
    "paired_event_id",
    "lthr",
    "icu_threshold_pace",
    "source_error",
    "interval_summary",
    "icu_zone_times",
    "hr_zone_times",
    "pace_zone_times",
)
EVENT_FIELDS = (
    "id",
    "name",
    "category",
    "type",
    "start_date_local",
    "moving_time",
    "distance",
    "icu_training_load",
    "paired_activity_id",
    "athlete_cannot_edit",
)
WELLNESS_FIELDS = (
    "id",
    "hrv",
    "restingHR",
    "sleepSecs",
    "sleepScore",
    "sleepQuality",
    "readiness",
    "weight",
    "spO2",
    "respiration",
    "soreness",
    "fatigue",
    "mood",
    "stress",
    "steps",
    "ctl",
    "atl",
    "rampRate",
)
COMPACT_FIELDS = {
    "activities": ACTIVITY_FIELDS,
    "events": EVENT_FIELDS,
    "wellness": WELLNESS_FIELDS,
}


def compact_records(table, rows, description_chars=400):
    fields = COMPACT_FIELDS.get(table)
    if fields is None:
        return rows
    result = []
    for row in rows:
        item = {k: row[k] for k in fields if row.get(k) not in (None, "", [], {})}
        text = row.get("description")
        if isinstance(text, str) and text.strip():
            item["description"] = text.strip()[:description_chars]
        result.append(item)
    return result


def period_start(day, group_by):
    if group_by == "month":
        return day.replace(day=1)
    return day - timedelta(days=day.weekday())


def period_label(start, group_by):
    return start.strftime("%Y-%m") if group_by == "month" else str(start)


def mean(values, digits=1):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), digits) if values else None


def training_summary(activities, wellness, oldest, newest, group_by="week"):
    """Per-week or per-month totals; sums only recorded values and reports what is missing."""
    periods = {}
    restriction_notes = set()

    def bucket(day):
        start = period_start(day, group_by)
        return periods.setdefault(
            start,
            {
                "period": period_label(start, group_by),
                "start": str(max(start, oldest)),
                "sessions": 0,
                "distance_km": None,
                "moving_time_min": None,
                "load": None,
                "missing_load": 0,
                "restricted": 0,
                "by_sport": {},
                "sources": {},
                "coverage": {},
                "_wellness": defaultdict(list),
                "_fitness": None,
            },
        )

    for row in activities:
        if not row.get("start_date_local"):
            continue
        day = date.fromisoformat(row["start_date_local"][:10])
        if not oldest <= day <= newest:
            continue
        agg = bucket(day)
        restricted = not row.get("type") and bool(row.get("_note"))
        if restricted:
            # The source withholds this activity's detail; it is a real session, not a gap.
            agg["restricted"] += 1
            restriction_notes.add(str(row["_note"])[:200])
        sport = agg["by_sport"].setdefault(
            row.get("type") or ("Restricted source" if restricted else "Unknown"),
            {"sessions": 0, "distance_km": None, "moving_time_min": None, "load": None},
        )
        agg["sessions"] += 1
        sport["sessions"] += 1
        distance, moving, load = (
            number(row.get("distance")),
            number(row.get("moving_time")),
            number(row.get("icu_training_load")),
        )
        source = row.get("source") or "intervals"
        agg["sources"][source] = agg["sources"].get(source, 0) + 1
        for key, value, scale in (
            ("distance_km", distance, 1 / 1000),
            ("moving_time_min", moving, 1 / 60),
            ("load", load, 1),
        ):
            coverage = agg["coverage"].setdefault(key, {"observed": 0, "missing": 0})
            coverage["observed" if value is not None else "missing"] += 1
            if value is not None:
                agg[key] = (agg[key] or 0) + value * scale
                sport[key] = (sport[key] or 0) + value * scale
        if load is None:
            agg["missing_load"] += 1

    for row in wellness:
        try:
            day = date.fromisoformat(str(row.get("id"))[:10])
        except ValueError:
            continue
        if not oldest <= day <= newest:
            continue
        agg = bucket(day)
        samples = agg["_wellness"]
        samples["days"].append(1)
        for source, dest, scale in (
            ("hrv", "hrv", 1),
            ("restingHR", "resting_hr", 1),
            ("sleepSecs", "sleep_hours", 1 / 3600),
            ("readiness", "readiness", 1),
            ("weight", "weight_kg", 1),
        ):
            value = number(row.get(source))
            if value is not None:
                samples[dest].append(value * scale)
        ctl, atl = number(row.get("ctl")), number(row.get("atl"))
        if ctl is not None and atl is not None:
            agg["_fitness"] = {
                "date": str(day),
                "ctl": round(ctl, 1),
                "atl": round(atl, 1),
                "form": round(ctl - atl, 1),
            }

    result = []
    for start in sorted(periods):
        agg = periods[start]
        samples = agg.pop("_wellness")
        fitness = agg.pop("_fitness")
        for key in ("distance_km", "moving_time_min", "load"):
            agg[key] = round(agg[key], 1) if agg[key] is not None else None
        for sport in agg["by_sport"].values():
            for key in ("distance_km", "moving_time_min", "load"):
                sport[key] = round(sport[key], 1) if sport[key] is not None else None
        wellness_summary = {"days": len(samples["days"])}
        for key in ("hrv", "resting_hr", "sleep_hours", "readiness", "weight_kg"):
            value = mean(samples[key])
            if value is not None:
                wellness_summary[key + "_avg"] = value
        agg["wellness"] = wellness_summary
        if fitness:
            agg["fitness_end"] = fitness
        result.append(agg)
    return {
        "group_by": group_by,
        "oldest": str(oldest),
        "newest": str(newest),
        "periods": result,
        "restriction_notes": sorted(restriction_notes),
        "note": "No observations means null, not zero. WHOOP elapsed duration is not moving time. Totals include only recorded values; missing_load counts sessions without a "
        "load and restricted counts sessions whose source withholds detail "
        "(see restriction_notes).",
    }


SETTINGS_FIELDS = (
    "id",
    "types",
    "ftp",
    "indoor_ftp",
    "w_prime",
    "lthr",
    "max_hr",
    "hr_zones",
    "hr_zone_names",
    "power_zones",
    "power_zone_names",
    "threshold_pace",
    "pace_units",
    "pace_zones",
    "pace_zone_names",
    "sweet_spot_min",
    "sweet_spot_max",
    "warmup_time",
    "cooldown_time",
    "updated",
)


def compact_settings(settings):
    """One row per Intervals settings record (not per sport type), zone fields only."""
    rows = {}
    for row in settings.values():
        key = str(row.get("id", id(row)))
        rows.setdefault(
            key, {k: row[k] for k in SETTINGS_FIELDS if row.get(k) not in (None, "", [], {})}
        )
    return list(rows.values())
