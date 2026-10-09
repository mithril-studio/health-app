"""User-authored shared profile and explicitly confirmed coaching continuity."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Text = Annotated[str, Field(strict=True, max_length=2000)]
Revision = Annotated[int, Field(strict=True, ge=0)]


class AthleteProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Eight editable text fields bound profile content to 16,000 characters total.
    goals: Text = ""
    target_date: date | None = None
    background: Text = ""
    availability: Text = ""
    other_sports: Text = ""
    equipment: Text = ""
    constraints: Text = ""
    preferences: Text = ""
    plan_context: Text = ""
    revision: Revision

    @field_validator("target_date", mode="before")
    @classmethod
    def iso_date(cls, value):
        if value is not None and (not isinstance(value, str) or len(value) != 10):
            raise ValueError("Expected ISO date")
        return value


class CoachingRecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    kind: Literal["observation", "recommendation", "question"]
    text: Annotated[str, Field(strict=True, min_length=1, max_length=4000)]
    rationale: Text


class CoachingRecordUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: Annotated[int, Field(strict=True, ge=1)]
    status: Literal["accepted", "dismissed", "completed"]
    outcome: Text


class CoachingConflict(Exception):
    """A stale revision, reused identifier, or invalid state transition."""


class CoachingRecordMissing(Exception):
    pass
