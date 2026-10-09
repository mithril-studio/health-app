import json
from datetime import date

import pytest

from coach.briefs import build_brief


class Store:
    async def athlete_profile(self):
        return {
            "goals": "Finish a trail race",
            "availability": "Three days",
            "plan_context": "User purpose",
            "revision": 1,
        }

    async def coaching_records(self):
        return [
            {"id": "1", "kind": "recommendation", "status": "proposed", "text": "Try hills"},
            {
                "id": "2",
                "kind": "recommendation",
                "status": "accepted",
                "text": "Easy Friday",
                "outcome": "Felt rested",
            },
        ]

    async def settings(self):
        return {"Run": {"lthr": 170}}

    async def sync_status(self):
        return {"last_success": None}


class Tools:
    def __init__(self, pages=3):
        self.offsets = []
        self.pages = pages

    async def call(self, name, args, **kwargs):
        if name == "get_activity_analysis":
            offset = args.get("offset", 0)
            self.offsets.append(offset)
            return {
                "activity": {
                    "id": args["id"],
                    "type": "Run",
                    "start_date_local": "2026-10-08",
                    "moving_time": 900,
                    "distance": 3000,
                    "icu_rpe": 5,
                },
                "intervals": [{"set": offset + 1, "average_heartrate": 150}],
                "total_intervals": self.pages,
                "next_offset": offset + 1 if offset + 1 < self.pages else None,
                "threshold": {"bpm": None},
                "hr_unavailable_reason": "No HR",
                "paired_workouts": [{"id": "9", "description": "Easy effort", "moving_time": 1000}],
            }
        if name == "get_calendar":
            return {
                "activities": [
                    {
                        "id": "prior",
                        "type": "Run",
                        "start_date_local": "2026-10-01",
                        "moving_time": 1000,
                        "description": "Felt good",
                    },
                    {"id": "soccer", "type": "Soccer", "start_date_local": "2026-10-07"},
                ],
                "events": [
                    {
                        "id": "unpaired",
                        "start_date_local": "2026-10-09",
                        "description": "Plan today",
                    }
                ],
            }
        if name == "get_training_summary":
            return {"periods": [], "note": "No cached measurements"}
        return []


async def test_workout_loads_every_page_pairing_feedback_and_cross_sport_context():
    tools = Tools()
    brief = await build_brief(
        Store(), tools, mode="workout", activity_id="selected", today=date(2026, 10, 9)
    )
    assert tools.offsets == [0, 1, 2]
    selected = brief["selected_activity"]
    assert [r["set"] for r in selected["intervals"]] == [1, 2, 3]
    assert selected["coverage"]["complete"] is True
    assert selected["paired_workouts"][0]["description"] == "Easy effort"
    assert selected["target_vs_actual"][0]["moving_time"]["difference"] == -100
    assert selected["activity"]["icu_rpe"] == 5
    assert brief["comparables"][0]["id"] == "prior"
    assert any(r["type"] == "Soccer" for r in brief["recent_activities"])
    assert "HR" in " ".join(selected["missing"])
    assert brief["athlete_profile"]["goals"] == "Finish a trail race"
    assert brief["coaching_records"]["proposed"][0]["id"] == "1"
    assert brief["coaching_records"]["accepted"][0]["outcome"] == "Felt rested"


async def test_interval_cap_reports_partial_instead_of_claiming_full_review():
    tools = Tools(pages=100)
    brief = await build_brief(
        Store(), tools, mode="workout", activity_id="a", today=date(2026, 10, 9)
    )
    coverage = brief["selected_activity"]["coverage"]
    assert 1 < len(tools.offsets) <= 20
    assert coverage["complete"] is False and coverage["next_offset"] is not None
    assert len(json.dumps(brief)) < 60000


async def test_daily_and_weekly_prioritize_explicit_plan_windows():
    daily = await build_brief(Store(), Tools(), mode="daily", today=date(2026, 10, 9))
    assert daily["today_plan"][0]["description"] == "Plan today"
    weekly = await build_brief(Store(), Tools(), mode="weekly", today=date(2026, 10, 9))
    assert weekly["review_window"] == {"oldest": "2026-10-03", "newest": "2026-10-09"}
    assert weekly["upcoming_window"] == {"oldest": "2026-10-10", "newest": "2026-10-16"}
    assert weekly["planned_vs_completed"][0]["status"] == "no_recorded_pairing"
    assert weekly["plan_context_note"].startswith("User-stated")


async def test_workout_requires_explicit_selection():
    with pytest.raises(ValueError):
        await build_brief(Store(), Tools(), mode="workout")


async def test_unpaired_title_is_not_target_and_large_evidence_retains_selected_sets():
    class LargeTools(Tools):
        async def call(self, name, args, **kwargs):
            result = await super().call(name, args, **kwargs)
            if name == "get_activity_analysis":
                result["activity"]["description"] = "x" * 10000
                result["paired_workouts"] = []
                result["activity"]["name"] = "5x1000 at 4:00"
                result["intervals"] = [
                    {
                        "set": args.get("offset", 0) * 30 + i,
                        "label": "x" * 100,
                        "average_heartrate": 150,
                    }
                    for i in range(30)
                ]
            return result

    brief = await build_brief(
        Store(), LargeTools(100), mode="workout", activity_id="a", today=date(2026, 10, 9)
    )
    assert brief["selected_activity"]["target_vs_actual"] == []
    assert "No recorded paired plan" in " ".join(brief["selected_activity"]["missing"])
    assert brief["selected_activity"]["intervals"]
    assert len(json.dumps(brief)) < 60000
