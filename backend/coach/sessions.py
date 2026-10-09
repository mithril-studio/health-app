from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, Field, model_validator

from coach.models import StrictModel, Title

LOCAL_SPORTS = Literal[
    "Run",
    "Ride",
    "Swim",
    "Soccer",
    "WeightTraining",
    "HomeWorkout",
    "Golf",
    "Tennis",
    "Walk",
    "Yoga",
    "Stretching",
    "Meditation",
    "Other",
]


class SessionInput(StrictModel):
    id: UUID
    name: Title
    sport: LOCAL_SPORTS
    start: AwareDatetime
    duration: Annotated[int, Field(strict=True, ge=1, le=86400)]
    notes: Annotated[str, Field(max_length=2000)] = ""

    @model_validator(mode="after")
    def completed(self):
        if self.start + timedelta(seconds=self.duration) > datetime.now(UTC) + timedelta(minutes=2):
            raise ValueError("Only completed sessions can be recorded")
        return self

    def activity(self):
        return {
            "id": "local-" + str(self.id),
            "source": "app",
            "name": self.name,
            "type": self.sport,
            "start_date": self.start.isoformat(),
            "start_date_local": self.start.astimezone(ZoneInfo("Europe/Amsterdam")).isoformat(),
            "moving_time": self.duration,
            "elapsed_time": self.duration,
            "description": self.notes,
        }


def sport_group(value):
    value = (value or "").lower().replace(" ", "").replace("_", "")
    groups = {
        "run": ("run", "running", "trailrun", "virtualrun"),
        "ride": ("ride", "cycling", "mountainbikeride", "virtualride", "spinning"),
        "strength": (
            "weighttraining",
            "weightlifting",
            "powerlifting",
            "crossfit",
            "strengthtrainer",
            "strengthtraining",
            "functionalfitness",
            "workout",
            "homeworkout",
            "fitness",
        ),
        "soccer": ("soccer", "football"),
        "swim": ("swim", "swimming"),
        "stretch": ("stretching", "yoga"),
    }
    return next((k for k, aliases in groups.items() if value in aliases), value)


def time_span(row):
    try:
        start = datetime.fromisoformat(row.get("start_date") or row["start_date_local"])
        if start.tzinfo is None:
            start = start.replace(tzinfo=ZoneInfo("Europe/Amsterdam"))
        seconds = row.get("elapsed_time") or row.get("moving_time")
        if not isinstance(seconds, (float, int)) or seconds <= 0:
            return None
        return start.timestamp(), seconds
    except (ValueError, KeyError, TypeError):
        return None


def duplicate_of(workout, primary):
    """Conservative match; missing timestamps/durations never imply a duplicate."""
    span = time_span(workout)
    if not span:
        return None
    start, seconds = span
    sport = sport_group(workout.get("type"))
    for row in primary:
        other = time_span(row)
        other_sport = sport_group(row.get("type"))
        if not other or (sport and other_sport and sport != other_sport):
            continue
        other_start, other_seconds = other
        overlap = min(start + seconds, other_start + other_seconds) - max(start, other_start)
        if abs(start - other_start) <= 600 and overlap >= 0.8 * max(seconds, other_seconds):
            return row["id"]
    return None


async def combined_activities(store, oldest, newest, *, review=False):
    primary = await store.range("activities", oldest, newest)
    local = await store.range("local_sessions", oldest, newest)
    whoop = await store.range("whoop_workouts", oldest, newest)
    # Include neighbouring days in matching for workouts near midnight.
    candidates = await store.range(
        "activities", oldest - timedelta(days=1), newest + timedelta(days=1)
    )
    candidates += await store.range(
        "local_sessions", oldest - timedelta(days=1), newest + timedelta(days=1)
    )
    reviewed = [{**row, "duplicate_of": duplicate_of(row, candidates)} for row in whoop]
    if review:
        return reviewed
    return primary + local + [row for row in reviewed if not row["duplicate_of"]]
