"""
Agent 1: Lab Assessor

Works out where the student is stuck from three things: the error they
describe, the commands they actually typed, and the tools the step expects.
"""

import re

from agents.text import backticked, edit_distance

ERROR_SIGNATURES = [
    ("PERMISSION_DENIED", r"permission denied|operation not permitted|eacces"),
    ("COMMAND_NOT_FOUND", r"command not found|not recognized|: not found"),
    ("PATH_NOT_FOUND", r"no such file or directory|cannot access|does not exist|enoent"),
    ("ALREADY_EXISTS", r"file exists|already exists"),
    ("SYNTAX_ERROR", r"syntax error|unexpected token|unexpected end of file|unterminated"),
    ("NOT_A_DIRECTORY", r"not a directory|is a directory"),
    ("CONNECTION_REFUSED", r"connection refused|could not resolve|network is unreachable|timed out"),
]

# Shell words that are not the tool being taught.
SHELL_WORDS = frozenset("sudo cd echo then do done if fi else for while in export set true false".split())

# Tool names that are also everyday English. In running prose ("find the
# largest file") they only count as a tool when written in backticks.
AMBIGUOUS = frozenset(
    "find sort top head tail test time watch kill make less more cut file host who date link split join "
    "yes sleep wait read source history service mount clear exit type tree diff patch free last uniq "
    "at w id man ip nice env apply plan init run build push pull status log tag add commit".split()
)

BASE_TOOLS = frozenset(
    "ls pwd mkdir rmdir touch cp mv rm ln cat less head tail grep egrep find sort uniq wc cut tr awk sed tee xargs "
    "chmod chown chgrp umask stat file du df free ps top kill pkill jobs nohup crontab systemctl journalctl "
    "tar gzip gunzip zip unzip curl wget ssh scp rsync ping dig nslookup netstat ss ip nc traceroute "
    "git docker kubectl helm terraform ansible make python python3 pip pip3 node npm bash sh vim nano "
    "aws trivy argocd promtool openssl base64 jq yq date whoami id env printenv which man history "
    "lsof sha256sum sleep tracepath trap nginx gunicorn pytest".split()
)

TOOL_NAME = re.compile(r"[a-z][a-z0-9_.+-]{1,20}")

MAX_TYPO_DISTANCE = 2
MIN_TYPO_LENGTH = 3


def command_name(command: str) -> str:
    """The program a command line runs: first word, skipping sudo and VAR=value prefixes."""
    for word in command.strip().split():
        if word == "sudo" or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", word):
            continue
        return word
    return ""


VOCABULARY = BASE_TOOLS - SHELL_WORDS


def expected_tools(step: dict, vocabulary: frozenset = VOCABULARY) -> list:
    """Programs the step asks the student to use, in the order it mentions them."""
    step = step or {}
    tools = []

    def add(name):
        if name in vocabulary and name not in tools:
            tools.append(name)

    for text in [step.get("description", ""), *step.get("tasks", [])]:
        quoted = backticked(text)
        for snippet in quoted:
            add(command_name(snippet))
        prose = re.sub(r"`[^`]*`", " ", text).lower()
        for word in re.findall(r"[a-z][a-z0-9_.+-]*", prose):
            if word not in AMBIGUOUS:
                add(word.rstrip("."))
    return tools


class LabAssessor:
    def assess(self, unit_id: str, step_number: int, user_query: str, command_history: list, step: dict = None) -> dict:
        history = [c for c in (command_history or []) if isinstance(c, str) and c.strip()]
        tools = expected_tools(step)
        used = [command_name(c) for c in history]

        assessment = {
            "unit_id": unit_id,
            "step_number": step_number,
            "recent_command": history[-1] if history else "",
            "commands_seen": len(history),
            "expected_tools": tools,
            "unused_tools": [t for t in tools if t not in used],
            "detected_issue": None,
            "typo": None,
        }

        # A misspelt tool is the most specific finding, so check it first.
        typo = self.find_typo(used, tools)
        if typo:
            assessment["detected_issue"] = "TYPO"
            assessment["typo"] = typo
            return assessment

        query = (user_query or "").lower()
        for issue, pattern in ERROR_SIGNATURES:
            if re.search(pattern, query):
                assessment["detected_issue"] = issue
                return assessment

        if tools and not history:
            assessment["detected_issue"] = "NOT_STARTED"
        return assessment

    def find_typo(self, used: list, tools: list):
        """
        The most recent typed command that is a near miss of a real tool.
        Tools the step expects are matched more generously than the rest of
        the vocabulary, where only a one-edit slip counts.
        """
        for typed in reversed(used):
            if typed in VOCABULARY or len(typed) < MIN_TYPO_LENGTH or not TOOL_NAME.fullmatch(typed):
                continue

            for tool in tools:
                # Short names differ by one edit all the time (cat/cut, ls/ln).
                allowed = 1 if len(tool) <= 4 else MAX_TYPO_DISTANCE
                if len(tool) >= MIN_TYPO_LENGTH and edit_distance(typed, tool, allowed) <= allowed:
                    return {"typed": typed, "expected": tool}

            if len(typed) >= 4:
                for tool in sorted(VOCABULARY):
                    if len(tool) >= 4 and edit_distance(typed, tool, 1) <= 1:
                        return {"typed": typed, "expected": tool}
        return None


assessor = LabAssessor()
