import json

import pytest

from coach.agent import bounded_json
from coach.workout import KEY_DURATIONS, analyze_workout, coach_result, compact_curves


def streams(times, hr):
    return [{"type": "time", "data": times}, {"type": "heartrate", "data": hr}]


def activity():
    return {
        "id": "run",
        "type": "Run",
        "elapsed_time": 10,
        "lthr": 165,
        "intervals": {
            "icu_intervals": [
                {
                    "type": "WORK",
                    "start_time": 0,
                    "end_time": 5,
                    "distance": 800,
                    "moving_time": 180,
                    "average_speed": 4.4,
                    "average_heartrate": 160,
                },
                {
                    "type": "RECOVERY",
                    "start_time": 5,
                    "end_time": 7,
                    "average_speed": 2.5,
                    "average_heartrate": 150,
                },
                {
                    "type": "WORK",
                    "start_time": 7,
                    "end_time": 10,
                    "distance": 800,
                    "moving_time": 175,
                    "average_speed": 4.6,
                    "average_heartrate": 172,
                },
            ],
            "icu_groups": [{"count": 2, "average_heartrate": 166}],
        },
    }


def test_individual_reps_and_strict_timestamp_weighted_threshold():
    result = analyze_workout(activity(), streams([0, 2, 5, 7, 10], [165, 170, 150, 175, 180]), {})
    assert result["session"] == {
        "above_lt2_seconds": 6,
        "hr_coverage_seconds": 10,
        "complete": True,
    }
    reps = result["intervals"]
    assert [r["average_heartrate"] for r in reps] == [160, 150, 172]
    assert [r["above_lt2_seconds"] for r in reps] == [3, 0, 3]
    assert reps[0]["average_pace_seconds_per_km"] == round(1000 / 4.4, 2)
    assert reps[2]["average_pace_seconds_per_km"] == round(1000 / 4.6, 2)
    assert result["threshold"] == {"bpm": 165, "source": "activity.lthr", "is_proxy": True}


def test_missing_hr_gaps_and_tail_are_not_counted_as_full_coverage():
    a = activity() | {"elapsed_time": 30}
    result = analyze_workout(a, streams([0, 3, 7, 25, 29], [170, None, 180, 175, 190]), {})
    assert result["session"] == {
        "above_lt2_seconds": 7,
        "hr_coverage_seconds": 7,
        "complete": False,
    }


@pytest.mark.parametrize(
    "data",
    [
        [],
        {"available": False},
        streams([0, 5, 3, 10], [170] * 4),
        streams([0, 0, 10], [170] * 3),
        streams([0, None, 10], [170] * 3),
    ],
)
def test_missing_or_invalid_streams_are_unknown(data):
    result = analyze_workout(activity(), data, {})
    assert result["session"]["above_lt2_seconds"] is None
    assert result["hr_unavailable_reason"]
    assert result["intervals"][0]["average_heartrate"] == 160


def test_threshold_provenance_and_missing_threshold():
    a = activity() | {"lthr": None}
    data = streams([0, 10], [170, 170])
    assert analyze_workout(a, data, {})["session"]["above_lt2_seconds"] is None
    result = analyze_workout(a, data, {"lthr": 168})
    assert result["threshold"]["source"] == "current_sport_settings.lthr"
    explicit = analyze_workout(activity(), data, {"lthr": 168}, lt2_hr=175)
    assert explicit["threshold"] == {"bpm": 175, "source": "user_supplied_lt2", "is_proxy": False}
    assert explicit["session"]["above_lt2_seconds"] == 0


def test_group_averages_never_become_reps_and_no_pace_is_invented():
    a = activity()
    a["intervals"].pop("icu_intervals")
    result = analyze_workout(a, [], {})
    assert result["intervals"] == []
    assert result["intervals_unavailable_reason"]
    a["intervals"]["icu_intervals"] = [{"type": "WORK"}]
    row = analyze_workout(a, [], {})["intervals"][0]
    assert row["average_pace_seconds_per_km"] is None
    assert row["above_lt2_seconds"] is None


def test_large_activity_keeps_all_reps_via_compact_pages():
    a = activity()
    a["raw_telemetry"] = "x" * 100000
    a["intervals"]["icu_intervals"] *= 40
    a["intervals"]["icu_groups"] = [{"unused": "x" * 100000}]
    offset, seen = 0, []
    while offset is not None:
        result = analyze_workout(a, [], {}, offset=offset)
        assert len(json.dumps(result)) < 20000
        assert json.loads(bounded_json(result, 20000)) == result
        seen.extend(row["set"] for row in result["intervals"])
        offset = result["next_offset"]
    assert seen == list(range(1, 121))


def test_compaction_preserves_plan_and_context_thresholds():
    raw = {
        "activities": [activity() | {"telemetry": "x" * 100000}],
        "events": [{"id": 21, "description": "5x800m at 3:50/km", "paired_activity_id": "run"}],
    }
    compact = coach_result("get_calendar", raw)
    assert compact["events"] == raw["events"]
    assert compact["activities"][0]["lthr"] == 165
    assert "telemetry" not in compact["activities"][0]
    context = {"calendar": raw, "settings": {"Run": {"lthr": 165}}, "today": "2026-10-08"}
    preserved = json.loads(bounded_json(context))
    assert preserved["settings"] == context["settings"]
    assert preserved["today"] == context["today"]


def pace_curves(points=1000):
    distances = [10 * (i + 1) for i in range(points)]
    return {
        "list": [
            {
                "id": "84d",
                "label": "84 days",
                "distance": distances,
                "values": [d * 0.216 for d in distances],
                "activity_id": [f"a{i % 25}" for i in range(points)],
                "unused": ["x" * 20] * points,
            }
        ],
        "activities": {
            f"a{i}": {"id": f"a{i}", "name": f"Run {i}", "type": "Run", "icu_zone_times": [1] * 50}
            for i in range(60)
        },
    }


def test_curve_compaction_keeps_exact_efforts_and_a_bounded_sample():
    compact = coach_result("get_curves", pace_curves())
    curve = compact["curves"][0]
    efforts = {e["distance"]: e for e in curve["key_efforts"]}
    assert efforts[5000] == {
        "distance": 5000,
        "seconds": 1080.0,
        "pace_s_per_km": 216.0,
        "time": "18:00",
        "activity_id": "a24",
    }
    assert 1609 not in efforts and 4990 not in efforts  # never interpolated
    distances = [s["distance"] for s in curve["samples"]]
    assert len(distances) <= 40 and len(set(distances)) == len(distances)
    assert 4990 not in distances and distances == sorted(distances)
    assert distances[0] == 10 and distances[-1] == 10000
    referenced = {e["activity_id"] for e in curve["key_efforts"] + curve["samples"]}
    assert set(compact["activities"]) == referenced
    assert compact["activities"]["a24"] == {"name": "Run 24", "type": "Run"}
    assert len(json.dumps(compact)) < 10000


def test_power_curve_keeps_key_durations_and_missing_values_stay_missing():
    secs = list(range(1, 3601))
    power = compact_curves({"list": [{"secs": secs, "watts": [1000 - s / 5 for s in secs]}]})
    curve = power["curves"][0]
    assert curve["kind"] == "power"
    assert [e["secs"] for e in curve["key_efforts"]] == list(KEY_DURATIONS)
    assert curve["key_efforts"][0] == {"secs": 5, "watts": 999.0}
    raw = pace_curves()
    raw["list"][0]["values"][499] = None  # the 5000 m point
    curve = compact_curves(raw)["curves"][0]
    assert 5000 not in [e["distance"] for e in curve["key_efforts"]]
    assert 5000 not in [s["distance"] for s in curve["samples"]]
    assert curve["measured_points"] == 999
