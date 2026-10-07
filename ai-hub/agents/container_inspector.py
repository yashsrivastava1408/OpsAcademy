"""
Agent 1.5: Container Inspector

Compares what the step's check looks for with what is actually in the
student's sandbox. The gateway sends the sandbox file tree and the step's
verification command; this agent reads the paths out of that command and
reports which ones are missing. It never repeats the verification command
itself or the text patterns it greps for.
"""

import re

HOME = "/home/student/"
# How deep the gateway lists the sandbox unless it says otherwise.
DEFAULT_TREE_DEPTH = 3

# `test -d path`, `[ -f path ]`
TEST_FLAG = re.compile(r"(?:\btest|\[)\s+-([defx])\s+([^\s\])&|;]+)")
# `grep ... 'pattern' path` - the last argument is the file being read.
GREP_FILE = re.compile(r"\bgrep\b[^|;&]*?\s(/home/student/[^\s|;&)]+)")
# `cat path`, `stat ... path`
READ_FILE = re.compile(r"\b(?:cat|stat|head|tail|wc)\b[^|;&]*?\s(/home/student/[^\s|;&)]+)")


def relative(path: str) -> str:
    path = path.strip("'\"")
    return path[len(HOME):] if path.startswith(HOME) else path


def expected_paths(verification_command: str) -> list:
    """Paths the check depends on, as [{'path', 'kind'}] with kind directory|file|any."""
    if not verification_command:
        return []

    found = {}
    for flag, path in TEST_FLAG.findall(verification_command):
        if path.startswith(HOME):
            kind = {"d": "directory", "f": "file", "x": "file"}.get(flag, "any")
            found[relative(path)] = kind
    for pattern in (GREP_FILE, READ_FILE):
        for path in pattern.findall(verification_command):
            found.setdefault(relative(path), "file")

    return [{"path": path, "kind": kind} for path, kind in found.items() if path]


class ContainerInspector:
    def inspect(self, step: dict = None, container_telemetry: dict = None) -> dict:
        telemetry = container_telemetry or {}
        tree = telemetry.get("fileTree")
        expected = expected_paths((step or {}).get("verificationCommand"))

        report = {
            "telemetry_active": tree is not None,
            "checked_paths": len(expected),
            "missing": [],
            "wrong_type": [],
            "present": [],
            "ports": telemetry.get("ports") or [],
        }
        # A partial listing cannot prove a path is absent.
        if tree is None or not expected or telemetry.get("truncated"):
            return report

        max_depth = telemetry.get("maxDepth", DEFAULT_TREE_DEPTH)
        expected = [item for item in expected if item["path"].count("/") < max_depth]

        actual = {entry["path"]: entry.get("type") for entry in tree if isinstance(entry, dict) and "path" in entry}
        for item in expected:
            path, kind = item["path"], item["kind"]
            if path not in actual:
                report["missing"].append(path)
            elif kind != "any" and actual[path] != kind:
                report["wrong_type"].append({"path": path, "expected": kind, "actual": actual[path]})
            else:
                report["present"].append(path)
        return report


inspector = ContainerInspector()
