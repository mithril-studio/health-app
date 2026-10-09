from datetime import date as Day
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Sport = Literal[
    "Run",
    "Ride",
    "Swim",
    "Soccer",
    "WeightTraining",
    "Workout",
    "Walk",
    "Hike",
    "TrailRun",
    "VirtualRun",
    "VirtualRide",
    "MountainBikeRide",
    "GravelRide",
    "Rowing",
    "Yoga",
    "Other",
]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,80}$")]
EventIdentifier = Annotated[str, StringConstraints(pattern=r"^[0-9]{1,12}$")]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(max_length=10000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DateRange(StrictModel):
    oldest: Day
    newest: Day

    @model_validator(mode="after")
    def ordered(self):
        if self.newest < self.oldest or (self.newest - self.oldest).days > 730:
            raise ValueError("date range must be ordered and at most 730 days")
        return self


class SummaryInput(DateRange):
    group_by: Literal["week", "month"] = "week"


class ActivityInput(StrictModel):
    id: Identifier


class CurvesInput(StrictModel):
    sport: Sport = "Run"
    period: Annotated[int, Field(strict=True, ge=1, le=730)] = 84


class PlanInput(StrictModel):
    date: Day
    name: Title
    sport: Sport
    description: Description


class DeleteInput(StrictModel):
    id: EventIdentifier


class MoveInput(DeleteInput):
    date: Day


class UpdateInput(DeleteInput):
    name: Title | None = None
    description: Description | None = None

    @model_validator(mode="after")
    def nonempty(self):
        if self.name is None and self.description is None:
            raise ValueError("provide name or description")
        return self


class ZonesInput(StrictModel):
    sport: Sport
    # Intervals uses metres/second, NOT min/km, for threshold_pace.
    threshold_pace: Annotated[float, Field(strict=True, gt=0, le=15)] | None = None
    ftp: Annotated[int, Field(strict=True, ge=30, le=1000)] | None = None
    hr_zones: (
        Annotated[
            list[Annotated[int, Field(strict=True, ge=30, le=250)]],
            Field(min_length=2, max_length=10),
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def valid_patch(self):
        if all(v is None for v in (self.threshold_pace, self.ftp, self.hr_zones)):
            raise ValueError("provide at least one setting")
        if self.hr_zones and any(
            a >= b for a, b in zip(self.hr_zones, self.hr_zones[1:], strict=False)
        ):
            raise ValueError("heart rate zones must increase strictly")
        return self


class LoginInput(StrictModel):
    password: Annotated[str, Field(min_length=1, max_length=1024)]


ConversationId = Annotated[str, StringConstraints(pattern=r"^(web|web:[a-f0-9]{32})$")]


class ChatInput(StrictModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]
    conversation_id: ConversationId = "web"


class JobInput(StrictModel):
    kind: Literal["morning", "evening", "activity"]
    key: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    activity_id: Identifier | None = None

    @model_validator(mode="after")
    def needs_activity(self):
        if self.kind == "activity" and not self.activity_id:
            raise ValueError("activity job requires activity_id")
        return self


TOOL_MODELS = {
    "get_calendar": DateRange,
    "get_activity": ActivityInput,
    "get_fitness": DateRange,
    "get_wellness": DateRange,
    "get_curves": CurvesInput,
    "get_training_summary": SummaryInput,
    "plan_workout": PlanInput,
    "move_workout": MoveInput,
    "update_workout": UpdateInput,
    "delete_workout": DeleteInput,
    "update_zones": ZonesInput,
}
READ_TOOLS = frozenset(name for name in TOOL_MODELS if name.startswith("get_"))
TOOL_DESCRIPTIONS = {
    "get_calendar": "Cached planned events and completed activities. Inclusive local ISO dates.",
    "get_activity": "Cached raw activity and lazy intervals; unavailable data remains missing.",
    "get_fitness": "CTL, ATL and form from Intervals wellness. No inferred fitness values.",
    "get_wellness": "Cached wellness and recovery records. Inclusive local ISO dates.",
    "get_curves": "Cached best pace (Run/Swim) or power (Ride) curves. Period is days.",
    "get_training_summary": "Weekly or monthly totals over any cached range (up to two years): "
    "sessions, distance, time and load per sport, wellness averages, end-of-period CTL/ATL/form. "
    "Use for month, season or year analysis before requesting detailed records.",
    "plan_workout": "Create a planned workout using Intervals text format.",
    "move_workout": "Move an existing planned workout to a local date, preserving its time.",
    "update_workout": "Update only the name or description of an existing planned workout.",
    "delete_workout": "Request deletion; the user must confirm separately in the web app.",
    "update_zones": "Update sport settings. threshold_pace is METRES PER SECOND; ftp watts; "
    "hr_zones are increasing BPM upper boundaries.",
}


def validate_tool(name: str, args: dict) -> StrictModel:
    if name not in TOOL_MODELS:
        raise ValueError("unknown tool")
    return TOOL_MODELS[name].model_validate(args)
