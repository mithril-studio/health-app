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


async def test_scores_save_read_clear_and_survive_sync(web):  # noqa: F811
    client, app = web
    path = "/api/athlete-scores"
    values = {"lt1_hr": 145, "lt2_hr": 172, "vo2max": 58.5}
    assert (await client.get(path)).status_code == 401
    assert (await client.post(path, json=values)).status_code == 401
    await client.post(
        "/api/login",
        json={"password": "correct-password"},
        headers={"Origin": "https://coach.test"},
    )
    assert (await client.post(path, json=values)).status_code == 403
    headers = {"Origin": "https://coach.test"}
    assert (await client.get(path)).json()["lt2_hr"] is None
    response = await client.post(path, json=values, headers=headers)
    assert response.status_code == 200
    assert response.json()["updated_at"]
    await app.state.tools.sync.run(today=date(2026, 10, 8))
    assert {
        k: v for k, v in (await client.get(path)).json().items() if k != "updated_at"
    } == values | {"hr_zones": None}
    cleared = dict.fromkeys(values)
    assert (await client.post(path, json=cleared, headers=headers)).status_code == 200
    assert (await client.get(path)).json()["lt2_hr"] is None
    assert app.state.tools.source.calls == []


@pytest.mark.parametrize(
    "patch",
    [
        {"lt1_hr": 180},
        {"lt2_hr": 145},
        {"lt2_hr": True},
        {"lt2_hr": 172.5},
        {"lt1_hr": 0},
        {"lt2_hr": 251},
        {"vo2max": 0},
        {"vo2max": 101},
        {"vo2max": "58"},
        {"extra": 1},
    ],
)
async def test_invalid_scores_do_not_replace_saved_values(web, patch):  # noqa: F811
    client, app = web
    values = {"lt1_hr": 145, "lt2_hr": 172, "vo2max": 58.5}
    await app.state.store.save_athlete_scores(AthleteScoresInput(**values))
    response = await client.post(
        "/api/athlete-scores", json=values | patch, headers={"Authorization": "Bearer api-secret"}
    )
    assert response.status_code == 422
    saved = await app.state.store.athlete_scores()
    assert {key: saved[key] for key in values} == values


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


async def test_zones_are_saved_available_to_coach_and_used_for_analysis(web):  # noqa: F811
    client, app = web
    values = {"lt1_hr": 145, "lt2_hr": 172, "vo2max": 58.5, "hr_zones": ZONES}
    headers = {"Authorization": "Bearer api-secret"}
    assert (
        await client.post("/api/athlete-scores", json=values, headers=headers)
    ).status_code == 200
    assert (await client.get("/api/athlete-scores", headers=headers)).json()["hr_zones"] == ZONES
    # Legacy clients updating scores cannot silently clear saved zones.
    assert (
        await client.post(
            "/api/athlete-scores",
            json={k: v for k, v in values.items() if k != "hr_zones"},
            headers=headers,
        )
    ).json()["hr_zones"] == ZONES
    await app.state.tools.sync.run(today=date(2026, 10, 8))
    context = await app.state.agent.context()
    assert context["athlete_scores"]["hr_zones"] == ZONES
    data = streams([0, 2, 4, 6, 8, 10], [110, 140, 160, 172, 185, 185])
    result = analyze_workout(activity(), data, {}, scores=context["athlete_scores"])
    assert [zone["seconds"] for zone in result["personal_hr_zones"]["zones"]] == [2] * 5
    assert result["personal_hr_zones"]["complete"] is True
    assert result["session"]["above_lt2_seconds"] == 2
    cleared = await client.post(
        "/api/athlete-scores", json=values | {"hr_zones": None}, headers=headers
    )
    assert cleared.json()["hr_zones"] is None
    assert cleared.json()["lt2_hr"] == 172


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
