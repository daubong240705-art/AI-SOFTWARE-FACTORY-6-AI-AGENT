"""Reviewed role instructions; frozen per run, never loaded from task repositories."""

import hashlib
import json
from typing import Any

SKILLS = {
    "pm": "Split the requirement into scoped steps, dependencies and risks. State assumptions. "
    "Do not invent delivery evidence or approve business decisions.",
    "ba": "Write verifiable acceptance criteria, negative/empty cases and explicit scope. "
    "Preserve the requirement's constraints and distinguish assumptions from requirements.",
    "be": "Read related source before changing it. Implement backend logic and data/API contracts. "
    "Preserve public interfaces unless the spec changes them. Handle invalid inputs and errors. "
    "Use test feedback to fix causes; never weaken tests or claim checks that were not run.",
    "fe": "Read related UI source and API contracts before changing them. Implement loading, empty "
    "and error states where relevant. Keep labels accessible and layouts responsive. "
    "Preserve backend contracts and report assumptions; never claim browser checks were run.",
    "test": "Execute the frozen trusted suite on the exact candidate. Preserve raw failure "
    "evidence and distinguish command failure from test failure. Never modify trusted tests.",
    "devops": "Verify candidate, owned pipeline, required checks and persisted release approval. "
    "Complete only after artifact identity and deployed health match. Preserve failed attempts.",
}
TOOLS = {
    "pm": [],
    "ba": [],
    "be": ["read", "edit", "glob", "grep"],
    "fe": ["read", "edit", "glob", "grep"],
    "test": ["trusted_test_suite"],
    "devops": ["verified_pipeline", "approved_deploy", "verified_health"],
}


def skill_snapshot() -> dict[str, Any]:
    return {
        role: {
            "id": f"asf-{role}",
            "version": 1,
            "instructions": content,
            "tools": TOOLS[role],
            "sha256": hashlib.sha256(
                json.dumps({"instructions": content, "tools": TOOLS[role]}, sort_keys=True).encode()
            ).hexdigest(),
        }
        for role, content in SKILLS.items()
    }
