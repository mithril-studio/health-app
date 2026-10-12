"""Compact, measured workout evidence for the coach; raw API records stay intact."""

from bisect import bisect_left
from math import log

from coach.analytics import compact_records, number


def pick(record, fields):
    return {key: record[key] for key in fields.split() if record.get(key) is not None}


ACTIVITY_FIELDS = (
    "id name type start_date_local distance moving_time elapsed_time average_speed "
    "average_heartrate max_heartrate icu_training_load lthr icu_threshold_pace "
    "description icu_rpe feel source source_error interval_summary session_duration whoop_strain"
)
EVENT_FIELDS = "id name type start_date_local category description paired_activity_id moving_time"
CURVE_FIELDS = "id label start_date_local end_date_local days"
KEY_DISTANCES = (400, 800, 1000, 1500, 1609, 2000, 3000, 5000, 10000, 15000, 21097, 42195)
KEY_DURATIONS = (5, 30, 60, 300, 1200, 3600)


def clock(seconds):
    seconds = round(seconds)
    return f"{seconds // 60}:{seconds % 60:02}"


def curve_points(curve):
    """Measured (x, y, index) points of one Intervals pace or power curve, by ascending x."""
    if "watts" in curve or ("distance" not in curve and "distances" not in curve):
        kind, xs, ys = "power", curve.get("secs"), curve.get("watts", curve.get("values"))
    else:
        kind = "pace"
        xs = curve.get("distance", curve.get("distances"))
        ys = curve.get("values", curve.get("secs"))
    if not isinstance(xs, list) or not isinstance(ys, list):
        return kind, []
    points = []
    for index, (x, y) in enumerate(zip(xs, ys, strict=False)):
        x, y = number(x), number(y)
        if x is not None and y is not None and x > 0 and y > 0:
            points.append((x, y, index))
    return kind, sorted(points)


def log_samples(points, count):
    """About count points spaced evenly on a log axis, snapped to measured points, no repeats."""
    if len(points) <= count:
        return points
    scale = [log(x) for x, _, _ in points]
    picked = set()
    for step in range(count):
        target = scale[0] + (scale[-1] - scale[0]) * step / (count - 1)
        i = min(bisect_left(scale, target), len(points) - 1)
        if i and target - scale[i - 1] < scale[i] - target:
            i -= 1
        picked.add(i)
    return [points[i] for i in sorted(picked)]


def compact_curve(curve, sample_points):
    kind, points = curve_points(curve)
    ids = curve.get("activity_id")
    ids = ids if isinstance(ids, list) else []
    x_name, y_name = ("distance", "seconds") if kind == "pace" else ("secs", "watts")

    def effort(x, y, index, key=False):
        item = {x_name: x, y_name: y}
        if key and kind == "pace":
            item |= {"pace_s_per_km": round(y * 1000 / x, 1), "time": clock(y)}
        if index < len(ids) and ids[index] is not None:
            item["activity_id"] = str(ids[index])
        return item

    exact = {x: (y, index) for x, y, index in points}
    keys = KEY_DISTANCES if kind == "pace" else KEY_DURATIONS
    return pick(curve, CURVE_FIELDS) | {
        "kind": kind,
        "measured_points": len(points),
        "key_efforts": [effort(x, *exact[x], key=True) for x in keys if x in exact],
        "samples": [effort(*point) for point in log_samples(points, sample_points)],
    }


def compact_curves(result, sample_points=40):
    """Best efforts at standard distances/durations plus a sparse curve shape, never interpolated."""
    curves = result.get("list", result.get("curves")) if isinstance(result, dict) else result
    if not isinstance(curves, list):
        return result
    compact = [compact_curve(c, sample_points) for c in curves if isinstance(c, dict)]
    referenced = {
        item["activity_id"]
        for curve in compact
        for item in curve["key_efforts"] + curve["samples"]
        if "activity_id" in item
    }
    activities = result.get("activities") if isinstance(result, dict) else None
    if isinstance(activities, list):
        activities = {str(a.get("id")): a for a in activities if isinstance(a, dict)}
    return {
        "curves": compact,
        "activities": {
            str(id): pick(activity, "name type start_date_local")
            for id, activity in (activities or {}).items()
            if str(id) in referenced and isinstance(activity, dict)
        },
        "note": "Values are measured best efforts: seconds at exact distances (pace) or watts at "
        "exact durations (power). key_efforts lists only standard points present in the curve; "
        "other points were omitted except a log-spaced sample. Never interpolate a missing point.",
    }


def coach_result(name, result):
    if name == "get_activity":
        return {
            "activity": pick(result, ACTIVITY_FIELDS),
            "detail_tool": "get_activity_analysis",
            "note": "Use get_activity_analysis with this activity id for individual sets, "
            "paired workouts, personal zones and LT2 duration. Raw telemetry is not included here.",
        }
    if name == "get_calendar":
        return {
            "activities": compact_records("activities", result["activities"]),
            "events": compact_records("events", result["events"]),
        }
    if name == "get_wellness":
        return compact_records("wellness", result)
    if name == "get_curves":
        return compact_curves(result)
    return result


def threshold(activity, settings, explicit=None, scores=None):
    if explicit is not None:
        return {"bpm": explicit, "source": "user_supplied_lt2", "is_proxy": False}
    if activity.get("type") in ("Run", "TrailRun", "VirtualRun") and scores:
        value = number(scores.get("lt2_hr"))
        if value is not None and value > 0:
            return {"bpm": value, "source": "athlete_scores.lt2_hr", "is_proxy": False}
    for source, value in (
        ("activity.lthr", activity.get("lthr")),
        ("current_sport_settings.lthr", settings.get("lthr")),
    ):
        value = number(value)
        if value is not None and value > 0:
            return {"bpm": value, "source": source, "is_proxy": True}
    return {"bpm": None, "source": None, "is_proxy": False}


def hr_spans(streams):
    """Use the recorded HR at t[i] over [t[i], t[i+1]); never extrapolate the tail."""
    if not isinstance(streams, list):
        return []
    data = {s.get("type"): s.get("data") for s in streams if isinstance(s, dict)}
    times, heart_rates = data.get("time"), data.get("heartrate")
    if not isinstance(times, list) or not isinstance(heart_rates, list):
        return []
    # Non-monotonic timestamps cannot support a trustworthy duration calculation.
    if any(number(t) is None for t in times) or any(
        end <= start for start, end in zip(times, times[1:], strict=False)
    ):
        return []
    return [
        (start, end, hr)
        for start, end, hr in zip(times, times[1:], heart_rates, strict=False)
        if number(hr) is not None and hr > 0 and end - start <= 10
    ]


def time_above(spans, bpm, start, end):
    result = {"above_lt2_seconds": None, "hr_coverage_seconds": 0, "complete": False}
    if bpm is None or start is None or end is None or end <= start:
        return result
    above, covered = 0, 0
    for left, right, hr in spans:
        duration = max(0, min(end, right) - max(start, left))
        covered += duration
        if hr > bpm:
            above += duration
    return {
        "above_lt2_seconds": round(above, 2) if covered else None,
        "hr_coverage_seconds": round(covered, 2),
        "complete": abs(covered - (end - start)) < 0.01,
    }


def time_in_hr_zones(spans, zones, end):
    if not zones:
        return {"source": None, "zones": [], "reason": "No personal running HR zones saved"}
    durations = [0] * len(zones)
    covered, outside = 0, 0
    if end is not None and end > 0:
        for start, finish, hr in spans:
            duration = max(0, min(end, finish) - max(0, start))
            covered += duration
            match = next(
                (i for i, zone in enumerate(zones) if zone["min_bpm"] <= hr <= zone["max_bpm"]),
                None,
            )
            if match is None:
                outside += duration
            else:
                durations[match] += duration
    return {
        "source": "athlete_scores.hr_zones",
        "zones": [
            dict(zone, name=f"Z{i + 1}", seconds=round(durations[i], 2) if covered else None)
            for i, zone in enumerate(zones)
        ],
        "hr_coverage_seconds": round(covered, 2),
        "outside_zones_seconds": round(outside, 2) if covered else None,
        "complete": bool(end and covered and abs(covered - end) < 0.01),
    }


def analyze_workout(activity, streams, settings, *, lt2_hr=None, scores=None, offset=0, limit=30):
    detail = activity.get("intervals", {})
    intervals = detail.get("icu_intervals", []) if isinstance(detail, dict) else detail
    intervals = intervals if isinstance(intervals, list) else []
    intervals = [row for row in intervals if isinstance(row, dict)]
    boundary = threshold(activity, settings, lt2_hr, scores)
    spans = hr_spans(streams)
    rows = []
    for index, interval in enumerate(intervals[offset : offset + limit], offset + 1):
        row = pick(
            interval,
            "type label distance moving_time elapsed_time average_heartrate max_heartrate "
            "start_time end_time",
        )
        speed = number(interval.get("average_speed"))
        row.update(
            set=index,
            average_pace_seconds_per_km=round(1000 / speed, 2) if speed and speed > 0 else None,
        )
        row.update(
            time_above(
                spans,
                boundary["bpm"],
                number(interval.get("start_time")),
                number(interval.get("end_time")),
            )
        )
        rows.append(row)
    end = number(activity.get("elapsed_time"))
    return {
        "activity": pick(
            activity,
            "id name type start_date_local distance moving_time elapsed_time "
            "average_speed average_heartrate max_heartrate icu_rpe feel source description "
            "session_duration whoop_strain",
        ),
        "threshold": boundary,
        "session": time_above(spans, boundary["bpm"], 0, end),
        "personal_hr_zones": time_in_hr_zones(
            spans,
            (scores or {}).get("hr_zones")
            if activity.get("type") in ("Run", "TrailRun", "VirtualRun")
            else None,
            end,
        ),
        "method": "HR strictly > threshold, timestamp-weighted left samples; no tail "
        "extrapolation; gaps >10s and missing HR excluded. Incomplete coverage is a "
        "measured subtotal, not a full-session total. LTHR is an LT2 proxy unless explicitly supplied.",
        "intervals": rows,
        "total_intervals": len(intervals),
        "next_offset": offset + limit if offset + limit < len(intervals) else None,
        "intervals_unavailable_reason": None
        if intervals
        else (
            detail.get("reason", "No individual intervals returned; grouped summaries are not reps")
            if isinstance(detail, dict)
            else "No individual intervals returned"
        ),
        "hr_unavailable_reason": None
        if spans
        else (
            streams.get("reason", "No usable timestamped heart-rate samples")
            if isinstance(streams, dict)
            else "No usable timestamped heart-rate samples"
        ),
    }
