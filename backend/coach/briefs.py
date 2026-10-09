"""Deterministic evidence selection for one coach, using the existing read tools."""

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from coach.analytics import compact_settings, number

MAX_INTERVAL_PAGES = 20
INSTRUCTIONS = {
    "chat": "Answer the question. Retrieve older evidence with tools when needed.",
    "workout": "Review the selected session and individual sets in order, compare recorded targets, then one useful takeaway. State partial coverage; never invent reps or pairing.",
    "daily": "Prioritize today's plan, recent workload across sports, wellness trends and athlete feedback. Offer one practical recommendation.",
    "weekly": "Review the past seven days against recorded plans, then the upcoming week against confirmed goals, availability, accepted decisions and outcomes.",
}


def size(value):
    return len(json.dumps(value, ensure_ascii=False, default=str))


def bounded_evidence(value, budget):
    """Retain evidence prefixes, with omissions next to the affected fields, never drop a section."""
    if size(value) <= budget:
        return value
    if isinstance(value, str):
        return value[: max(0, budget - 80)] + " [text truncated by evidence budget]"
    if isinstance(value, list):
        result = []
        for item in value:
            item = bounded_evidence(item, min(4000, max(200, budget // 3)))
            if size(result + [item]) > budget - 150:
                break
            result.append(item)
        return result + [{"budget_omitted_records": len(value) - len(result)}]
    if isinstance(value, dict):
        allowance = max(100, (budget - size(list(value))) // max(1, len(value)))
        return {key: bounded_evidence(item, allowance) for key, item in value.items()}
    return value


def target_comparison(activity, plans):
    result = []
    for plan in plans:
        row = {"event_id": plan.get("id")}
        for key in ("moving_time", "distance", "icu_training_load"):
            target, actual = number(plan.get(key)), number(activity.get(key))
            if target is not None:
                row[key] = {
                    "target": target,
                    "actual": actual,
                    "difference": actual - target if actual is not None else None,
                }
        if len(row) > 1:
            result.append(row)
    return result


async def workout_evidence(tools, activity_id):
    selected, offset, seen = None, 0, set()
    for _ in range(MAX_INTERVAL_PAGES):
        page = await tools.call(
            "get_activity_analysis", {"id": activity_id, "offset": offset}, read_only=True
        )
        if selected is None:
            selected = {
                **page,
                "activity": bounded_evidence(page["activity"], 2000),
                "intervals": [],
            }
        if size(selected["intervals"] + page["intervals"]) > 18000:
            break
        selected["intervals"].extend(page["intervals"])
        seen.add(offset)
        offset = page["next_offset"]
        if offset is None or offset in seen:
            break
    selected["next_offset"] = offset
    selected["coverage"] = {
        "complete": offset is None,
        "loaded_intervals": len(selected["intervals"]),
        "total_intervals": selected["total_intervals"],
        "next_offset": offset,
        "page_cap": MAX_INTERVAL_PAGES,
        "note": "Bounded cached interval evidence; non-null next_offset means partial coverage.",
    }
    selected["paired_workouts"] = bounded_evidence(selected.get("paired_workouts", []), 5000)
    selected["target_vs_actual"] = target_comparison(
        selected["activity"], selected["paired_workouts"]
    )
    selected["missing"] = []
    for key in ("hr_unavailable_reason", "intervals_unavailable_reason"):
        if selected.get(key):
            selected["missing"].append(selected[key])
    if not selected.get("threshold", {}).get("bpm"):
        selected["missing"].append("No recorded or current-settings threshold available")
    if not selected["paired_workouts"]:
        selected["missing"].append(
            "No recorded paired plan; nearby events are not verified pairing"
        )
    if not selected["target_vs_actual"]:
        selected["missing"].append(
            "No supported structured aggregate targets; do not infer numeric targets from titles or free text"
        )
    return selected


async def build_brief(store, tools, *, mode="chat", activity_id=None, today=None):
    if mode not in INSTRUCTIONS or (mode == "workout" and not activity_id):
        raise ValueError("Invalid coaching task or missing workout activity_id")
    today = today or datetime.now(ZoneInfo("Europe/Amsterdam")).date()
    brief = {
        "mode": mode,
        "instructions": INSTRUCTIONS[mode],
        "today": str(today),
        "timezone": "Europe/Amsterdam",
        "sync": await store.sync_status(),
        "athlete_profile": bounded_evidence(await store.athlete_profile(), 4000),
        "coaching_records": {},
        "plan_context_note": "User-stated purpose only; profile plan_context does not verify an event/activity pairing.",
        "settings": bounded_evidence(compact_settings(await store.settings()), 3000),
    }
    records = await store.coaching_records()
    for status in ("proposed", "accepted", "dismissed", "completed"):
        brief["coaching_records"][status] = bounded_evidence(
            [r for r in records if r["status"] == status], 1000
        )
    selected = await workout_evidence(tools, activity_id) if mode == "workout" else None
    anchor = today
    if selected and selected["activity"].get("start_date_local"):
        anchor = datetime.fromisoformat(selected["activity"]["start_date_local"]).date()

    async def calendar(oldest, newest):
        return await tools.call(
            "get_calendar", {"oldest": str(oldest), "newest": str(newest)}, read_only=True
        )

    recent = await calendar(
        anchor - timedelta(days=6), anchor + timedelta(days=7 if mode == "weekly" else 1)
    )
    activities = sorted(
        recent["activities"], key=lambda r: r.get("start_date_local", ""), reverse=True
    )
    brief["recent_activities"] = bounded_evidence(activities, 3500)
    brief["wellness"] = bounded_evidence(
        await tools.call(
            "get_wellness",
            {"oldest": str(anchor - timedelta(days=6)), "newest": str(anchor)},
            read_only=True,
        ),
        2500,
    )
    brief["recent_weeks"] = bounded_evidence(
        await tools.call(
            "get_training_summary",
            {"oldest": str(anchor - timedelta(days=27)), "newest": str(anchor)},
            read_only=True,
        ),
        4000,
    )
    brief["coverage"] = {
        "recent_activity_count": len(activities),
        "wellness_note": "Absent dates/metrics are missing, not normal or zero; cached sources may be incomplete.",
    }
    events = recent["events"]
    if mode == "workout":
        brief["selected_activity"] = selected
        previous = await calendar(anchor - timedelta(days=90), anchor)
        activity = selected["activity"]
        candidates = [
            r
            for r in previous["activities"]
            if r.get("type") == activity.get("type")
            and r.get("id") != activity_id
            and r.get("start_date_local", "") < activity.get("start_date_local", "")
        ]
        duration = number(activity.get("moving_time"))
        candidates.sort(
            key=lambda r: (
                abs(r["moving_time"] - duration)
                if duration is not None and number(r.get("moving_time")) is not None
                else float("inf"),
                r.get("start_date_local", ""),
            )
        )
        brief["comparables"] = bounded_evidence(candidates[:5], 3000)
        brief["comparison_basis"] = (
            "Prior 90 days, same recorded sport, nearest measured duration; similarity is context, not proof of identical workouts."
        )
    elif mode == "weekly":
        brief["review_window"] = {"oldest": str(today - timedelta(days=6)), "newest": str(today)}
        brief["upcoming_window"] = {
            "oldest": str(today + timedelta(days=1)),
            "newest": str(today + timedelta(days=7)),
        }
        past = [e for e in events if str(e.get("start_date_local", ""))[:10] <= str(today)]
        brief["planned_vs_completed"] = bounded_evidence(
            [
                {
                    "plan": e,
                    "status": "recorded_pairing"
                    if e.get("paired_activity_id")
                    else "no_recorded_pairing",
                    "completed": next(
                        (a for a in activities if a.get("id") == e.get("paired_activity_id")), None
                    ),
                }
                for e in past
            ],
            5000,
        )
        brief["upcoming_plan"] = bounded_evidence(
            [e for e in events if str(e.get("start_date_local", ""))[:10] > str(today)], 3500
        )
    else:
        brief["today_plan"] = bounded_evidence(
            [e for e in events if str(e.get("start_date_local", ""))[:10] == str(today)], 4000
        )
        brief["upcoming_plan"] = bounded_evidence(
            [e for e in events if str(e.get("start_date_local", ""))[:10] > str(today)], 2500
        )
    return brief
