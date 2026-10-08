import json
import os
import sys
from pathlib import Path

import pytest

# The optional embedding model would make results depend on whether it is
# installed and how far it has loaded; its own tests use a stand-in.
os.environ["SEMANTIC_SEARCH"] = "off"

HUB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HUB_DIR))

UNITS_DIR = HUB_DIR.parent / "server" / "data" / "units"


def load_steps():
    """Every lab step in the shape the gateway sends: (unit, number, step)."""
    steps = []
    for practice_path in sorted(UNITS_DIR.glob("*/practice.json")):
        for step in json.loads(practice_path.read_text()).get("steps", []):
            steps.append((practice_path.parent.name, step["step"], {
                "title": step["title"],
                "description": step.get("description", ""),
                "tasks": step.get("tasks", []),
                "verificationCommand": (step.get("verification") or {}).get("command"),
            }))
    return steps


ALL_STEPS = load_steps()


@pytest.fixture
def project_step():
    """linux-basics step 2: build a directory tree with mkdir and touch."""
    return next(step for unit, number, step in ALL_STEPS if unit == "linux-basics" and number == 2)


def tree(*paths):
    """tree('webapp/', 'webapp/a.txt') -> telemetry as the gateway sends it."""
    return {
        "fileTree": [{"path": p.rstrip("/"), "type": "directory" if p.endswith("/") else "file"} for p in paths],
        "ports": [],
    }
