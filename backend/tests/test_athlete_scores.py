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


async def test_retained_scores_cannot_override_evidence_or_reach_context(web):  # noqa: F811
    _, app = web
    values = {"lt1_hr": 145, "lt2_hr": 172, "vo2max": 58.5}
    await app.state.store.save_athlete_scores(AthleteScoresInput(**values))
    a = activity()
    await app.state.store.put("activity_intervals", "run", a.pop("intervals"))
    await app.state.store.put("activities", "run", a, date(2026, 10, 8))
    await app.state.store.put("activity_streams", "run", streams([0, 5, 10], [170, 175, 175]))
    result = await app.state.tools.call("get_activity_analysis", {"id": "run"}, read_only=True)
    assert result["threshold"] == {"bpm": 165, "source": "activity.lthr", "is_proxy": True}
    assert result["session"]["above_lt2_seconds"] == 10
    context = await app.state.agent.context()
    assert "athlete_scores" not in context
    assert (await app.state.store.athlete_scores())["lt2_hr"] == 172
    # Clearing retained data cannot change the authoritative recorded LTHR.
    await app.state.store.save_athlete_scores(AthleteScoresInput(**(values | {"lt2_hr": None})))
    result = await app.state.tools.call("get_activity_analysis", {"id": "run"})
    assert result["threshold"]["source"] == "activity.lthr"
    assert result["session"]["above_lt2_seconds"] == 10


def test_recorded_threshold_and_explicit_override_keep_provenance():
    result = analyze_workout(activity() | {"type": "Ride"}, [], {})
    assert result["threshold"]["bpm"] == 165
    result = analyze_workout(activity(), [], {}, lt2_hr=180)
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


def test_retired_personal_zones_are_not_reconstructed():
    data = streams([0, 2, 4, 6, 8, 10], [95, 130, None, 175, 210, 185])
    result = analyze_workout(activity(), data, {})
    assert "personal_hr_zones" not in result
    assert result["session"]["hr_coverage_seconds"] == 8
    assert result["session"]["complete"] is False
    missing = analyze_workout(activity(), [], {})
    assert missing["session"]["above_lt2_seconds"] is None
