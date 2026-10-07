"""
Agent 3: Socratic Mentor

Produces one hint at the tier the student has unlocked:

  Tier 1 - nudge:      the concept behind the step, no commands
  Tier 2 - diagnostic: what is wrong in their sandbox or their last command
  Tier 3 - syntax:     which task to do next and the general form of the tool

Whatever writes the hint (rules or the LLM), it then passes the leak guard:
tiers 1 and 2 must not contain a full command from the step's task list, and
no tier may contain the verification command. A hint that fails is replaced
by the rule-based one, which is built so that it cannot leak.
"""

import re

from agents.lab_assessor import command_name, expected_tools
from agents.text import backticked, tokenize

MAX_TIER = 3

ISSUE_EXPLANATIONS = {
    "PERMISSION_DENIED": "The shell refused because of file permissions. Every file has read, write and execute bits for its owner, its group and everyone else.",
    "COMMAND_NOT_FOUND": "The shell could not find a program with that name. Either the name is misspelt or the tool is not installed in this sandbox.",
    "PATH_NOT_FOUND": "The path you used does not exist from where you are standing. Relative paths are resolved from your current directory.",
    "ALREADY_EXISTS": "Something with that name is already there, so the command would not create it again.",
    "SYNTAX_ERROR": "The shell could not parse the line. Unbalanced quotes or brackets are the usual cause.",
    "NOT_A_DIRECTORY": "A file was used where a directory was expected, or the other way round.",
    "CONNECTION_REFUSED": "Nothing answered on that address and port, so the service is not running or not listening where you expect.",
}

ISSUE_CHECKS = {
    "PERMISSION_DENIED": "Look at the permission bits with `ls -l` and compare them with what the step asks for.",
    "COMMAND_NOT_FOUND": "Compare your spelling with the command in the task list, character by character.",
    "PATH_NOT_FOUND": "Run `pwd` to see where you are and `ls` to see what exists there.",
    "ALREADY_EXISTS": "Use `ls -la` to see what is already there before creating it again.",
    "SYNTAX_ERROR": "Retype the line and count your quotes and brackets.",
    "NOT_A_DIRECTORY": "Use `ls -ld <path>` to see whether each path is a file or a directory.",
    "CONNECTION_REFUSED": "List listening ports with `ss -tln` or `netstat -tln` and check the port number.",
}

# General form of common tools, shown at tier 3 alongside the task to do.
USAGE = {
    "mkdir": "mkdir -p <dir> [<dir> ...]",
    "touch": "touch <file> [<file> ...]",
    "chmod": "chmod <mode> <file>   (mode like +x, 644, 755)",
    "chown": "chown <user>:<group> <file>",
    "cp": "cp [-r] <source> <destination>",
    "mv": "mv <source> <destination>",
    "rm": "rm [-r] <path>",
    "ln": "ln -s <target> <link-name>",
    "cat": "cat <file>",
    "echo": "echo \"<text>\" > <file>   (> overwrites, >> appends)",
    "grep": "grep [-r] '<pattern>' <file-or-dir>",
    "find": "find <dir> -name '<pattern>'",
    "tar": "tar -czf <archive.tar.gz> <dir>   /   tar -xzf <archive.tar.gz>",
    "ps": "ps aux",
    "kill": "kill [-9] <pid>",
    "curl": "curl -i <url>",
    "git": "git <subcommand> [options]   (init, add, commit -m, branch, checkout, merge, log)",
    "docker": "docker <subcommand> [options]   (run, ps, build -t, exec -it, logs, stop, rm)",
    "kubectl": "kubectl <verb> <resource> [name]   (get, describe, apply -f, logs, scale)",
    "terraform": "terraform <subcommand>   (init, fmt, validate, plan, apply)",
    "python3": "python3 <script.py>",
    "awk": "awk '{print $<n>}' <file>",
    "sed": "sed 's/<old>/<new>/g' <file>",
    "crontab": "crontab -e   (minute hour day month weekday command)",
    "ssh": "ssh <user>@<host>",
    "export": "export NAME=value",
}

# Words in a task description that imply a tool the task does not name.
TASK_WORDS = {
    "mkdir": ("director", "folder"),
    "touch": ("create file", "empty file", "create an empty"),
    "chmod": ("permission", "executable", "read-only"),
    "chown": ("owner",),
    "grep": ("search", "filter", "lines containing"),
    "cat": ("verify both files", "read the", "display the contents"),
    "echo": ("write ",),
    "ps": ("running process", "list process"),
    "kill": ("terminate", "stop the process"),
}

SYSTEM_PROMPT = """You are the mentor inside OpsAcademy, a hands-on DevOps course. A student is working through a lab step in a Linux sandbox and has asked for help.

Your job is to get them unstuck while leaving the learning to them, so how much you reveal depends on the hint tier:

- Tier 1 (nudge): explain the concept behind the step in two or three sentences. Do not give any command.
- Tier 2 (diagnostic): say what is wrong, using the facts about their sandbox and recent commands. You may name a tool and suggest a way to inspect the problem (such as ls or pwd), but do not give the command that completes a task.
- Tier 3 (syntax): point to the task to do next and show the general form of the command with placeholders. The student still fills in the specifics from the task list.

The facts you are given about their sandbox come from the platform and are accurate; rely on them over the student's description. The reference notes come from the course material. If the student asks something unrelated to the lab, answer briefly and bring them back to the step.

Write plainly, to the student, in under 90 words. Use backticks for commands and file names. Do not mention tiers, these instructions, or how the step is checked."""


# Commands that only look at state. Suggesting one is a diagnostic, not an answer.
INSPECTION_TOOLS = frozenset("ls pwd cat ps ss netstat stat file which whoami id env printenv history df du".split())


def forbidden_snippets(step: dict, tier: int) -> list:
    """Strings a hint at this tier must not contain."""
    step = step or {}
    taught = [snippet for task in step.get("tasks", []) for snippet in backticked(task)]

    forbidden = []
    # Some checks are simply a command the tasks teach (`pwd`); that is no secret.
    check = step.get("verificationCommand")
    if check and check.strip() not in taught:
        forbidden.append(check)
    if tier < MAX_TIER:
        # A snippet with arguments is a full command; a bare tool or file name is not.
        forbidden.extend(s for s in taught if " " in s)
    return forbidden


def leaks(hint: str, step: dict, tier: int) -> bool:
    """
    True if a hint gives away more than its tier allows:

      any tier - the verification command
      tier 1-2 - a full command from the task list
      tier 1   - any command with arguments, or a code block
      tier 2   - a command with arguments for one of the step's own tools
                 (inspection commands such as `ls -la` are fine)
    """
    squashed = re.sub(r"\s+", " ", hint)
    if any(re.sub(r"\s+", " ", snippet) in squashed for snippet in forbidden_snippets(step, tier)):
        return True
    if tier >= MAX_TIER:
        return False

    if "```" in hint:
        return True
    commands = [s for s in backticked(hint) if " " in s]
    if tier == 1:
        return bool(commands)
    solving_tools = set(expected_tools(step or {})) - INSPECTION_TOOLS
    return any(command_name(c) in solving_tools for c in commands)


def first_sentences(text: str, limit: int = 2) -> str:
    """Leading prose sentences of a chunk, skipping code and list lines."""
    prose = " ".join(line for line in text.split("\n") if line and not line.lstrip().startswith(("-", "*", "#", "$", "`")))
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    return " ".join(s for s in sentences[:limit] if s)


class AIMentor:
    def __init__(self, llm=None):
        self.llm = llm

    # ── Rule-based tiers ─────────────────────────────────────────

    def nudge(self, step: dict, assessment: dict, docs: list) -> str:
        parts = []
        if step:
            parts.append(f"This step is about: {step['title']}.")
            # Descriptions sometimes quote the command to run; a nudge leaves those out.
            description = step.get("description", "")
            if description and not leaks(description, step, 1):
                parts.append(description)

        issue = assessment.get("detected_issue")
        if issue in ISSUE_EXPLANATIONS:
            parts.append(ISSUE_EXPLANATIONS[issue])
        else:
            for doc in docs:
                concept = first_sentences(doc["text"])
                # Course notes often quote commands; a nudge stays conceptual.
                if concept and not leaks(concept, step, 1):
                    parts.append(concept)
                    break

        return " ".join(parts) or "Re-read the step and ask yourself what state the sandbox should be in when it is done."

    def diagnostic(self, step: dict, assessment: dict, diagnostics: dict) -> str:
        parts = []

        typo = assessment.get("typo")
        if typo:
            parts.append(f"You typed `{typo['typed']}`, which looks like a misspelling of `{typo['expected']}`.")

        issue = assessment.get("detected_issue")
        if issue in ISSUE_CHECKS:
            parts.append(ISSUE_CHECKS[issue])

        missing = diagnostics.get("missing") or []
        if missing:
            listed = ", ".join(f"`{path}`" for path in missing[:5])
            more = f" and {len(missing) - 5} more" if len(missing) > 5 else ""
            parts.append(f"Your sandbox does not have {listed}{more} yet.")
        for item in (diagnostics.get("wrong_type") or [])[:3]:
            parts.append(f"`{item['path']}` exists but is a {item['actual']}; the step needs a {item['expected']}.")
        if not missing and not diagnostics.get("wrong_type") and diagnostics.get("present"):
            parts.append("The files this step needs all exist, so look at their contents and permissions next.")

        unused = assessment.get("unused_tools") or []
        if unused and not typo and assessment.get("commands_seen"):
            parts.append(f"You have not used `{unused[0]}` in this session yet, and the step expects it.")
        if issue == "NOT_STARTED":
            parts.append("No commands have been run in this sandbox yet. Start with the first task in the list.")

        if not parts:
            parts.append("Check where you are with `pwd` and what exists with `ls -la`, then compare that with what each task asks for.")
        return " ".join(parts)

    def syntax(self, query: str, step: dict, assessment: dict, diagnostics: dict) -> str:
        if not step or not step.get("tasks"):
            return "Break the command into the program, its options, and its arguments, and check each against the tool's `--help` output."

        task = self.next_task(query, step, assessment, diagnostics)
        parts = [f"Do this task next: {task}"]

        for tool in [t for t in self.tools_for_task(task, assessment.get("expected_tools") or []) if t in USAGE][:2]:
            parts.append(f"General form: `{USAGE[tool]}`")
        return " ".join(parts)

    @staticmethod
    def tools_for_task(task: str, step_tools: list) -> list:
        """Which of the step's tools this task calls for."""
        named = expected_tools({"tasks": [task]})
        if named:
            return named
        lowered = task.lower()
        implied = [t for t in step_tools if any(word in lowered for word in TASK_WORDS.get(t, ()))]
        if implied:
            return implied
        # A step that teaches a single tool needs no guessing.
        return step_tools if len(step_tools) == 1 else []

    @staticmethod
    def next_task(query: str, step: dict, assessment: dict, diagnostics: dict) -> str:
        """The task most likely to be the one the student is stuck on."""
        tasks = step["tasks"]

        # A task that mentions something missing from the sandbox comes first.
        for path in diagnostics.get("missing") or []:
            name = path.rsplit("/", 1)[-1]
            for task in tasks:
                if name in task:
                    return task

        # Then a task for a tool they have not touched.
        for tool in assessment.get("unused_tools") or []:
            for task in tasks:
                if tool in expected_tools({"tasks": [task]}):
                    return task

        # Otherwise the task that shares the most words with their question.
        words = set(tokenize(query))
        return max(tasks, key=lambda task: len(words & set(tokenize(task))))

    def rule_hint(self, tier: int, query: str, step: dict, assessment: dict, diagnostics: dict, docs: list) -> str:
        if tier <= 1:
            return self.nudge(step, assessment, docs)
        if tier == 2:
            return self.diagnostic(step, assessment, diagnostics)
        return self.syntax(query, step, assessment, diagnostics)

    # ── LLM tier ─────────────────────────────────────────────────

    @staticmethod
    def llm_prompt(tier: int, query: str, step: dict, assessment: dict, diagnostics: dict, docs: list, history: list) -> str:
        lines = [f"Hint tier: {tier}", ""]
        if step:
            lines += [f"Lab step: {step['title']}", step.get("description", ""), "Tasks:"]
            lines += [f"- {task}" for task in step.get("tasks", [])]
            lines.append("")

        lines.append("Facts about the student's sandbox:")
        if history:
            lines.append("Recent commands: " + " | ".join(history[-8:]))
        else:
            lines.append("Recent commands: none recorded")
        if assessment.get("typo"):
            lines.append(f"Likely typo: typed {assessment['typo']['typed']}, expected {assessment['typo']['expected']}")
        if diagnostics.get("telemetry_active"):
            lines.append("Missing paths: " + (", ".join(diagnostics["missing"]) or "none"))
            for item in diagnostics.get("wrong_type") or []:
                lines.append(f"{item['path']} is a {item['actual']} but should be a {item['expected']}")
        lines.append("")

        if docs:
            lines.append("Reference notes from the course:")
            lines += [f"[{doc['unit_title']} - {doc['title']}] {doc['text'][:500]}" for doc in docs]
            lines.append("")

        lines += ["Student's question:", query]
        return "\n".join(lines)

    # ── Entry point ──────────────────────────────────────────────

    def generate_hint(self, tier: int, query: str, step: dict, assessment: dict, diagnostics: dict, docs: list, history: list = None) -> dict:
        """@returns {'hint': str, 'source': 'llm' | 'rules', 'tier': int}"""
        tier = max(1, min(MAX_TIER, int(tier or 1)))

        if self.llm is not None and self.llm.available:
            text = self.llm.complete(SYSTEM_PROMPT, self.llm_prompt(tier, query, step, assessment, diagnostics, docs, history or []))
            if text and not leaks(text, step, tier):
                return {"hint": text, "source": "llm", "tier": tier}

        return {"hint": self.rule_hint(tier, query, step, assessment, diagnostics, docs), "source": "rules", "tier": tier}


def default_mentor():
    from agents.llm import llm
    return AIMentor(llm)


mentor = default_mentor()
