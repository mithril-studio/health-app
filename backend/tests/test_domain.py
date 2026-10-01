from datetime import date

import pytest
from pydantic import ValidationError

from coach.analytics import fitness_from_wellness, insights
from coach.models import validate_tool
from coach.sync import sync_window


def test_strict_tool_allowlist():
    for name, args in [
        ("delete_workout", {"id": "22", "confirmed": True}),
        ("update_workout", {"id": "22", "athlete_id": "other"}),
        (
            "plan_workout",
            {
                "date": "2026-10-01",
                "sport": "Run",
                "name": "x",
                "description": "x",
                "url": "https://evil",
            },
        ),
        ("get_activity", {"id": "../../athlete"}),
        ("update_zones", {"sport": "Run", "ftp": True}),
        ("update_zones", {"sport": "Run", "hr_zones": [160, 140]}),
        ("update_zones", {"sport": "Run", "threshold_pace": float("nan")}),
        ("update_workout", {"id": "22"}),
        ("get_calendar", {"oldest": "2026-10-02", "newest": "2026-10-01"}),
    ]:
        with pytest.raises((ValueError, ValidationError)):
            validate_tool(name, args)
    with pytest.raises(ValueError):
        validate_tool("confirm_delete", {"token": "anything"})
    assert (
        validate_tool(
            "plan_workout",
            {"date": "2026-10-01", "sport": "Run", "name": "Easy", "description": "- 30m Z2"},
        ).sport
        == "Run"
    )


def test_fitness_comes_from_wellness_and_preserves_missing():
    rows = fitness_from_wellness(
        [
            {"id": "2026-10-01", "ctl": 30, "atl": 40},
            {"id": "2026-10-02", "ctl": 0, "atl": 0},
            {"id": "2026-10-03", "ctl": None, "atl": 10},
        ]
    )
    assert rows == [
        {"date": "2026-10-01", "ctl": 30, "atl": 40, "form": -10},
        {"date": "2026-10-02", "ctl": 0, "atl": 0, "form": 0},
        {"date": "2026-10-03", "ctl": None, "atl": 10, "form": None},
    ]


def test_weekly_aggregation_keeps_sports_and_missing_measurements():
    data = insights(
        [
            {
                "id": "a",
                "start_date_local": "2026-09-28T08:00:00",
                "type": "Run",
                "icu_training_load": 40,
                "moving_time": 1800,
                "icu_zone_times": [{"id": "Z1", "secs": 600}],
                "hr_zone_times": [100, 200],
            },
            {
                "id": "b",
                "start_date_local": "2026-09-29T08:00:00",
                "type": "Soccer",
                "icu_training_load": 60,
                "moving_time": 3600,
            },
            {"id": "c", "start_date_local": "2026-09-30T08:00:00", "type": "Run"},
        ],
        [],
        {},
    )
    run = next(r for r in data["weekly_load"] if r["sport"] == "Run")
    assert run["week"] == "2026-09-28"
    assert run["load"] == 40 and run["missing_load"] == 1 and run["count"] == 2
    assert {r["sport"] for r in data["weekly_load"]} == {"Run", "Soccer"}
    assert data["time_in_zones"][0]["power"] == {"Z1": 600}
    assert data["goals"]["best_5k_seconds"] is None


def test_backfill_is_calendar_months_and_overlap():
    assert sync_window(date(2024, 2, 29), None) == (date(2023, 2, 28), date(2024, 2, 29))
    assert sync_window(date(2026, 10, 1), date(2026, 9, 30)) == (
        date(2026, 9, 23),
        date(2026, 10, 1),
    )
