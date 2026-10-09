"""Cross-layer acceptance checks using real cache projections and synthetic evidence."""

from datetime import date

from coach.briefs import build_brief
from coach.tools import ToolService


async def test_daily_brief_preserves_plan_instructions_and_athlete_feedback(store):
    today = date(2026, 10, 9)
    await store.put(
        "events",
        "plan",
        {
            "id": "plan",
            "start_date_local": str(today),
            "type": "Run",
            "description": "Easy conversational effort; shorten if tired",
        },
        today,
    )
    await store.put(
        "local_sessions",
        "local-feedback",
        {
            "id": "local-feedback",
            "start_date_local": str(today),
            "type": "Yoga",
            "source": "app",
            "description": "Felt stiff after yesterday",
        },
        today,
    )
    brief = await build_brief(store, ToolService(store, None), mode="daily", today=today)
    assert brief["today_plan"][0]["description"] == "Easy conversational effort; shorten if tired"
    assert brief["recent_activities"][0]["description"] == "Felt stiff after yesterday"


async def test_real_workout_brief_compares_structured_targets_preserving_zero(store):
    today = date(2026, 10, 9)
    await store.put(
        "activities",
        "run",
        {
            "id": "run",
            "start_date_local": str(today),
            "type": "Run",
            "moving_time": 0,
            "distance": 0,
            "icu_training_load": 0,
        },
        today,
    )
    await store.put("activity_intervals", "run", [])
    await store.put("activity_streams", "run", [])
    await store.put(
        "events",
        "plan",
        {
            "id": "plan",
            "start_date_local": str(today),
            "type": "Run",
            "paired_activity_id": "run",
            "moving_time": 600,
            "distance": 1000,
            "icu_training_load": 10,
        },
        today,
    )
    brief = await build_brief(
        store, ToolService(store, None), mode="workout", activity_id="run", today=today
    )
    comparison = brief["selected_activity"]["target_vs_actual"][0]
    assert comparison["distance"] == {"actual": 0, "target": 1000, "difference": -1000}
    assert comparison["moving_time"]["actual"] == 0
    assert comparison["icu_training_load"]["actual"] == 0
