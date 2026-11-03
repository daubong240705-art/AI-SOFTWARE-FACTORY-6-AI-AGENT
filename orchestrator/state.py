from typing import TypedDict

ACTIVE = ("created", "planning", "waiting_approval", "running")
EXECUTABLE = ("created", "planning", "running")
TRANSITIONS = {
    "created": {"planning", "cancelled", "failed"},
    "planning": {"waiting_approval", "cancelled", "failed"},
    "waiting_approval": {"running", "rejected", "cancelled", "failed"},
    "running": {"waiting_integration", "cancelled", "failed"},
    "failed": {"created"},
    "rejected": {"created"},
    "cancelled": set(),
    "waiting_integration": set(),
}


class WorkflowState(TypedDict):
    # Only references, never repository files or complete model transcripts.
    run_id: str
    spec_version: int
    plan_id: str
    spec_id: str


class Superseded(Exception):
    """A cancelled or newer generation owns this run now."""


class WorkflowError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def transition(current: str, target: str) -> str:
    if target not in TRANSITIONS.get(current, set()):
        raise WorkflowError("invalid_transition")
    return target
