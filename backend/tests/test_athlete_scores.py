from datetime import date

import pytest
from test_guards import web  # noqa: F401
from test_workout import activity, streams

from coach.models import AthleteScoresInput
from coach.workout import analyze_workout

ZONES = [
    dict(min_bpm=low, max_bpm=high)
    for low, high in [(100, 130), (131, 145), (146, 160), (161, 175), (176, 200)]
]


async def test_saved_scores_reach_context_and_drive_analysis(web):  # noqa: F811
    _, app = web
    values = {"lt1_hr": 145, "lt2_hr": 172, "vo2max": 58.5}
    await app.state.store.save_athlete_scores(AthleteScoresInput(**values))
    a = activity()
    await app.state.store.put("activity_intervals", "run", a.pop("intervals"))
    await app.state.store.put("activities", "run", a, date(2026, 10, 8))
    await app.state.store.put("activity_streams", "run", streams([0, 5, 10], [170, 175, 175]))
    result = await app.state.tools.call("get_activity_analysis", {"id": "run"}, read_only=True)
    assert result["threshold"] == {"bpm": 172, "source": "athlete_scores.lt2_hr", "is_proxy": False}
    assert result["session"]["above_lt2_seconds"] == 5
    context = await app.state.agent.context()
    assert {key: context["athlete_scores"][key] for key in values} == values
    # Clearing the personal threshold restores the existing recorded LTHR fallback.
    await app.state.store.save_athlete_scores(AthleteScoresInput(**(values | {"lt2_hr": None})))
    result = await app.state.tools.call("get_activity_analysis", {"id": "run"})
    assert result["threshold"]["source"] == "activity.lthr"
    assert result["session"]["above_lt2_seconds"] == 10


def test_running_scores_do_not_override_cycling_thresholds():
    result = analyze_workout(activity() | {"type": "Ride"}, [], {}, scores={"lt2_hr": 172})
    assert result["threshold"]["bpm"] == 165
    result = analyze_workout(activity(), [], {}, lt2_hr=180, scores={"lt2_hr": 172})
    assert result["threshold"]["bpm"] == 180


@pytest.mark.parametrize(
    "zones",
    [
        [],
        ZONES[:4],
        ZONES + [ZONES[-1]],
        [ZONES[0] | {"min_bpm": 131}, *ZONES[1:]],
        [ZONES[0], ZONES[1] | {"min_bpm": 130}, *ZONES[2:]],
        [ZONES[0], ZONES[1] | {"min_bpm": 132}, *ZONES[2:]],
        [ZONES[0] | {"min_bpm": True}, *ZONES[1:]],
        [ZONES[0] | {"min_bpm": 100.5}, *ZONES[1:]],
    ],
)
def test_zone_validation(zones):
    with pytest.raises(ValueError):
        AthleteScoresInput(lt1_hr=None, lt2_hr=None, vo2max=None, hr_zones=zones)


def test_zone_coverage_and_missing_data_are_explicit():
    data = streams([0, 2, 4, 6, 8, 10], [95, 130, None, 175, 210, 185])
    result = analyze_workout(activity(), data, {}, scores={"hr_zones": ZONES})
    zones = result["personal_hr_zones"]
    assert zones["hr_coverage_seconds"] == 8
    assert zones["outside_zones_seconds"] == 4
    assert zones["complete"] is False
    assert [zone["seconds"] for zone in zones["zones"]] == [2, 0, 0, 2, 0]
    missing = analyze_workout(activity(), [], {}, scores={"hr_zones": ZONES})
    assert all(zone["seconds"] is None for zone in missing["personal_hr_zones"]["zones"])
