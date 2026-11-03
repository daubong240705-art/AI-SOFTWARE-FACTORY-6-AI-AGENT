from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

Text = Annotated[str, Field(min_length=1, max_length=1500)]
Items = Annotated[list[Text], Field(min_length=1, max_length=20)]


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    goal: Text
    steps: Items
    risks: Annotated[list[Text], Field(max_length=20)]


class Specification(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    summary: Text
    functional_requirements: Items
    acceptance_criteria: Items
    out_of_scope: Annotated[list[Text], Field(max_length=20)]


ROLES: dict[str, dict[str, Any]] = {
    "pm": {"implemented": True, "writes": ["plan"], "tools": []},
    "ba": {"implemented": True, "writes": ["spec"], "tools": []},
    "be": {"implemented": False, "writes": [], "tools": []},
    "fe": {"implemented": False, "writes": [], "tools": []},
    "test": {"implemented": False, "writes": [], "tools": []},
    "devops": {"implemented": False, "writes": [], "tools": []},
}


def mock_content(role: str, requirement: str) -> dict[str, object]:
    # Deterministic development fixture, never presented as model execution.
    if role == "pm":
        return Plan(
            goal=requirement[:1500],
            steps=["Review requirement", "Draft specification"],
            risks=["Simulated plan; requires human review"],
        ).model_dump()
    if role == "ba":
        return Specification(
            summary=requirement[:1500],
            functional_requirements=["Implement the reviewed requirement"],
            acceptance_criteria=["Human verifies behavior against the requirement"],
            out_of_scope=["Code generation and deployment in Phase 2"],
        ).model_dump()
    raise ValueError("Role is not implemented")
