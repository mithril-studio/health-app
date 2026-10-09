"""The coach can analyse a month or a year from the cache, not only the last week."""

from datetime import date, timedelta

from test_tools import WritableSource

from coach.analytics import compact_records, compact_settings, training_summary
from coach.tools import ToolService


def run(day, load=50, distance=10000, sport="Run"):
    return {
        "id": f"a{day}",
        "type": sport,
        "start_date_local": f"{day}T07:00:00",
        "distance": distance,
        "moving_time": 3000,
        "icu_training_load": load,
        "device_name": "watch",  # not training relevant: dropped by the compact projection
        "description": None,
    }


def test_summary_groups_by_week_and_month_and_counts_missing_load():
    oldest, newest = date(2026, 1, 5), date(2026, 3, 1)
    activities = [
        run(date(2026, 1, 5)),
        run(date(2026, 1, 7), load=None),
        run(date(2026, 2, 3), sport="Soccer", distance=None),
        {
            "id": "s1",
            "start_date_local": "2026-02-10T18:00:00",
            "source": "STRAVA",
            "_note": "STRAVA activities are not available via the API",
        },
    ]
    wellness = [
        {"id": "2026-01-05", "hrv": 60, "restingHR": 50, "sleepSecs": 7200, "ctl": 30, "atl": 35},
        {"id": "2026-01-06", "hrv": 70, "restingHR": None, "sleepSecs": None, "ctl": 31, "atl": 34},
        {"id": "2025-12-31", "hrv": 999},  # outside the range: ignored
    ]
    weekly = training_summary(activities, wellness, oldest, newest, "week")
    assert [p["period"] for p in weekly["periods"]] == ["2026-01-05", "2026-02-02", "2026-02-09"]
    first = weekly["periods"][0]
    assert first["sessions"] == 2 and first["missing_load"] == 1 and first["load"] == 50
    assert first["distance_km"] == 20.0 and first["by_sport"]["Run"]["sessions"] == 2
    assert first["wellness"] == {
        "days": 2,
        "hrv_avg": 65.0,
        "resting_hr_avg": 50.0,
        "sleep_hours_avg": 2.0,
    }
    assert first["fitness_end"] == {"date": "2026-01-06", "ctl": 31, "atl": 34, "form": -3}
    monthly = training_summary(activities, wellness, oldest, newest, "month")
    assert [p["period"] for p in monthly["periods"]] == ["2026-01", "2026-02"]
    assert monthly["periods"][1]["by_sport"] == {
        "Soccer": {"sessions": 1, "distance_km": None, "moving_time_min": 50.0, "load": 50.0},
        "Restricted source": {
            "sessions": 1,
            "distance_km": None,
            "moving_time_min": None,
            "load": None,
        },
    }
    assert monthly["periods"][1]["restricted"] == 1 and monthly["periods"][0]["restricted"] == 0
    assert monthly["restriction_notes"] == ["STRAVA activities are not available via the API"]


def test_compact_records_keep_training_fields_and_drop_noise():
    rows = compact_records("activities", [run(date(2026, 1, 5)) | {"description": "  Tempo  "}])
    assert rows == [
        {
            "id": "a2026-01-05",
            "type": "Run",
            "start_date_local": "2026-01-05T07:00:00",
            "distance": 10000,
            "moving_time": 3000,
            "icu_training_load": 50,
            "description": "Tempo",
        }
    ]
    assert compact_records("fitness_daily", [{"date": "2026-01-05", "ctl": None}]) == [
        {"date": "2026-01-05", "ctl": None}
    ]


async def test_year_of_wellness_fits_the_tool_budget_and_summary_covers_it(store):
    service = ToolService(store, WritableSource())
    today = date(2026, 10, 7)
    for offset in range(365):
        day = today - timedelta(days=offset)
        raw = {"id": str(day), "hrv": 60, "restingHR": 52, "sleepSecs": 27000, "ctl": 40, "atl": 38}
        raw |= {f"unused_{i}": None for i in range(40)} | {
            "sportInfo": [{"type": "Run", "eftp": 1}]
        }
        await store.put("wellness", str(day), raw, day)
        if offset % 3 == 0:
            await store.put("activities", f"a{day}", run(day), day)
    oldest = today - timedelta(days=364)
    import json

    wellness = await service.call("get_wellness", {"oldest": str(oldest), "newest": str(today)})
    assert len(wellness) == 365 and "unused_0" not in wellness[0]
    assert len(json.dumps(wellness)) < 80000
    summary = await service.call(
        "get_training_summary",
        {"oldest": str(oldest), "newest": str(today), "group_by": "month"},
    )
    assert len(summary["periods"]) == 13 and sum(p["sessions"] for p in summary["periods"]) == 122
    assert len(json.dumps(summary)) < 16000
    calendar = await service.call("get_calendar", {"oldest": str(oldest), "newest": str(today)})
    assert len(calendar["activities"]) == 122 and "device_name" not in calendar["activities"][0]


def test_settings_snapshot_is_one_row_per_record_with_zone_fields_only():
    row = {
        "id": 7,
        "types": ["Ride", "VirtualRide", "GravelRide"],
        "ftp": 250,
        "hr_zones": [120, 140, 160, 180],
        "display": {"colours": ["#fff"] * 40},
        "activity_charts": ["x"] * 20,
        "threshold_pace": None,
    }
    settings = {sport: row for sport in row["types"]}
    assert compact_settings(settings) == [
        {
            "id": 7,
            "types": ["Ride", "VirtualRide", "GravelRide"],
            "ftp": 250,
            "hr_zones": [120, 140, 160, 180],
        }
    ]
