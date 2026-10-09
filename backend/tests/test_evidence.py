from datetime import date

from coach.analytics import training_summary
from coach.tools import ToolService


def test_missing_aggregates_stay_null_and_real_zero_is_observed():
    rows = [{"id": "a", "start_date_local": "2026-10-05", "type": "Run", "distance": 0}]
    result = training_summary(rows, [], date(2026, 10, 5), date(2026, 10, 5))
    period = result["periods"][0]
    assert period["distance_km"] == 0
    assert period["load"] is None and period["moving_time_min"] is None
    assert period["coverage"]["load"] == {"observed": 0, "missing": 1}
    assert period["coverage"]["distance_km"] == {"observed": 1, "missing": 0}
    assert period["by_sport"]["Run"]["load"] is None
    assert period["sources"] == {"intervals": 1}


async def test_summary_uses_calendar_sources_and_deduplication():
    base = {"start_date_local": "2026-10-05T10:00:00", "type": "Run", "elapsed_time": 600}

    class Store:
        async def range(self, table, *args):
            return {
                "activities": [dict(base, id="i1", moving_time=600)],
                "local_sessions": [dict(base, id="local-1", type="Yoga", source="app")],
                "whoop_workouts": [
                    dict(base, id="whoop-1", source="whoop"),
                    dict(base, id="whoop-2", type="Swim", source="whoop"),
                ],
            }.get(table, [])

        async def sync_status(self):
            return {"last_success": "2026-10-05T12:00:00Z"}

    service = ToolService(Store(), None)
    args = {"oldest": "2026-10-05", "newest": "2026-10-05"}
    calendar = await service.call("get_calendar", args)
    result = await service.call("get_training_summary", args)
    assert result["periods"][0]["sessions"] == len(calendar["activities"]) == 3
    assert result["periods"][0]["sources"] == {"intervals": 1, "app": 1, "whoop": 1}
    assert result["freshness"]["last_success"] == "2026-10-05T12:00:00Z"
