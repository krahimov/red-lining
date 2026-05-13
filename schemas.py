"""
Shared Pydantic models for the redlining pipeline.

Three boundary types, one source of truth:
- PlaybookClause   : a clause loaded from playbook.json (forgiving of extra fields)
- Redline          : a single finding from the model OR the reference set
- RedlineResponse  : the top-level {"redlines": [...]} that the model returns

The "snippet must appear in the document" check is intentionally NOT enforced
here -- it depends on the document, which lives outside the schema -- so the
caller runs that check after Pydantic has confirmed the structural shape.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class PlaybookClause(BaseModel):
    """One entry from playbook.json.

    `extra="ignore"` because the source playbook has ~10 fields per clause and
    we only consume 6 of them. Ignoring extras keeps the schema permissive
    without us having to enumerate every legacy field.
    """

    model_config = ConfigDict(extra="ignore")

    clause: str = Field(..., min_length=1)
    clause_definition: str = ""
    red_flag: str = ""
    example_ideal_clause: str = ""
    example_fallback_clause: str = ""
    is_required: bool = True

    def to_compact_view(self) -> dict:
        """The compacted view shown to the LLM (~5x smaller than the full clause)."""
        return {
            "clause": self.clause,
            "definition": self.clause_definition,
            "red_flags": self.red_flag,
            "ideal_example": self.example_ideal_clause,
            "fallback_example": self.example_fallback_clause,
            "is_required": self.is_required,
        }


class Redline(BaseModel):
    """One finding -- the spec output shape, exactly."""

    model_config = ConfigDict(extra="ignore")

    text_snippet: str = Field(..., min_length=1)
    playbook_clause_reference: str = Field(..., min_length=1)
    suggested_fix: str = Field(..., min_length=1)

    @field_validator("text_snippet", "playbook_clause_reference", "suggested_fix")
    @classmethod
    def _strip(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("field cannot be empty or whitespace-only")
        return s


class RedlineResponse(BaseModel):
    """The model's top-level JSON object."""

    redlines: List[Redline]


# ---------- Loading helpers ----------

def load_playbook(path: str) -> list[PlaybookClause]:
    """Load and validate a playbook.json file.

    Raises ValidationError with a clear message if any clause is malformed --
    typically the actionable thing to do here is fix the playbook.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Playbook must be a top-level JSON array of clauses.")
    return [PlaybookClause.model_validate(c) for c in raw]


def load_redlines(path: str) -> list[Redline]:
    """Load and validate a redlines JSON file (either model output or reference)."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Redlines file must be a top-level JSON array.")
    return [Redline.model_validate(r) for r in raw]


__all__ = [
    "PlaybookClause",
    "Redline",
    "RedlineResponse",
    "ValidationError",
    "load_playbook",
    "load_redlines",
]
