import pytest

from agents.container_inspector import expected_paths, inspector
from agents.lab_assessor import assessor, command_name, expected_tools
from agents.text import edit_distance, stem, tokenize

from conftest import ALL_STEPS, tree


# ── text helpers ─────────────────────────────────────────────

@pytest.mark.parametrize("a,b,distance", [
    ("mkdir", "mkdir", 0),
    ("mkidr", "mkdir", 1),   # swapped neighbours
    ("mkdr", "mkdir", 1),    # dropped letter
    ("mkdirr", "mkdir", 1),  # doubled letter
    ("kubctl", "kubectl", 1),
    ("cat", "cut", 1),
])
def test_edit_distance(a, b, distance):
    assert edit_distance(a, b) == distance


def test_edit_distance_of_unrelated_words_is_over_the_limit():
    assert edit_distance("docker", "kubectl") > 2
    assert edit_distance("ls", "terraform") == 3  # length gap alone rules it out


def test_tokenize_stems_and_drops_stopwords():
    assert tokenize("The containers are mounted on volumes") == ["container", "mount", "volume"]
    assert [stem(w) for w in ("volumes", "volume", "policies", "classes", "bus", "status", "running")] == [
        "volume", "volume", "policy", "class", "bus", "status", "runn"]
    assert tokenize("Use `df -h` and /var/log") == ["df", "h", "var/log"]


# ── assessor ─────────────────────────────────────────────────

@pytest.mark.parametrize("command,name", [
    ("mkdir -p a/b", "mkdir"),
    ("sudo systemctl restart nginx", "systemctl"),
    ("FOO=bar BAZ=1 python3 app.py", "python3"),
    ("   ls", "ls"),
    ("", ""),
])
def test_command_name(command, name):
    assert command_name(command) == name


def test_expected_tools_come_from_prose_and_backticks(project_step):
    assert expected_tools(project_step) == ["mkdir", "touch"]
    assert expected_tools({"tasks": ["Run `docker ps -a` then `git status`"]}) == ["docker", "git"]


def test_everyday_words_are_not_tools_unless_backticked():
    assert expected_tools({"description": "Find the largest file and sort the list at the top"}) == []
    assert expected_tools({"tasks": ["Use `find . -name '*.log'` and `sort -n`"]}) == ["find", "sort"]


def test_expected_tools_handles_missing_step():
    assert expected_tools(None) == []
    assert expected_tools({}) == []


@pytest.mark.parametrize("typed,expected", [
    ("mkidr webapp", "mkdir"),
    ("mkdr webapp", "mkdir"),
    ("tuch a.txt", "touch"),
    ("toucj a.txt", "touch"),
])
def test_detects_typos_of_the_steps_tools(project_step, typed, expected):
    result = assessor.assess("linux-basics", 2, "help", ["ls", typed], project_step)
    assert result["detected_issue"] == "TYPO"
    assert result["typo"] == {"typed": typed.split()[0], "expected": expected}


def test_detects_one_slip_typos_of_any_known_tool(project_step):
    result = assessor.assess("linux-basics", 2, "help", ["kubctl get pods"], project_step)
    assert result["typo"] == {"typed": "kubctl", "expected": "kubectl"}


@pytest.mark.parametrize("history", [
    ["mkdir webapp", "touch a"],
    ["cat a", "cut -f1 a", "sed -n 1p a", "nano a", "vim a"],
    ["./deploy.sh", "/usr/bin/env", "..", "a.out"],
    ["mk"],
    ["unrelatedprogram --flag"],
])
def test_real_commands_are_not_typos(project_step, history):
    assert assessor.assess("linux-basics", 2, "help", history, project_step)["typo"] is None


def test_the_latest_typo_wins(project_step):
    result = assessor.assess("linux-basics", 2, "help", ["mkidr a", "tuch b"], project_step)
    assert result["typo"]["typed"] == "tuch"


@pytest.mark.parametrize("query,issue", [
    ("bash: ./run.sh: Permission denied", "PERMISSION_DENIED"),
    ("zsh: command not found: dockr", "COMMAND_NOT_FOUND"),
    ("cat: a.txt: No such file or directory", "PATH_NOT_FOUND"),
    ("mkdir: cannot create directory 'a': File exists", "ALREADY_EXISTS"),
    ("syntax error near unexpected token", "SYNTAX_ERROR"),
    ("curl: (7) Connection refused", "CONNECTION_REFUSED"),
    ("why is the sky blue", None),
])
def test_recognises_errors_the_student_pastes(query, issue):
    assert assessor.assess("u", 1, query, ["ls"], None)["detected_issue"] == issue


def test_not_started_when_nothing_was_run(project_step):
    result = assessor.assess("linux-basics", 2, "where do I begin", [], project_step)
    assert result["detected_issue"] == "NOT_STARTED"
    assert result["unused_tools"] == ["mkdir", "touch"]


def test_unused_tools_shrink_as_the_student_works(project_step):
    result = assessor.assess("linux-basics", 2, "help", ["mkdir webapp"], project_step)
    assert result["unused_tools"] == ["touch"]
    assert result["recent_command"] == "mkdir webapp"


def test_assessor_ignores_junk_in_history(project_step):
    result = assessor.assess("linux-basics", 2, "help", [None, 42, "", "  ", "mkdir a"], project_step)
    assert result["commands_seen"] == 1


# ── inspector ────────────────────────────────────────────────

def test_expected_paths_from_test_flags():
    command = "test -d /home/student/app && test -f /home/student/app/a.txt && [ -x /home/student/run.sh ] && echo PASS || echo FAIL"
    assert expected_paths(command) == [
        {"path": "app", "kind": "directory"},
        {"path": "app/a.txt", "kind": "file"},
        {"path": "run.sh", "kind": "file"},
    ]


def test_expected_paths_from_grep_and_cat():
    command = "grep -q 'required_version' /home/student/tf/versions.tf && cat /home/student/tf/main.tf | grep -c resource"
    assert expected_paths(command) == [{"path": "tf/versions.tf", "kind": "file"}, {"path": "tf/main.tf", "kind": "file"}]


@pytest.mark.parametrize("command", [None, "", "pwd", "docker ps | grep web && echo PASS", "test -f /etc/passwd"])
def test_checks_without_student_paths_yield_nothing(command):
    assert expected_paths(command) == []


def test_reports_missing_present_and_wrong_type(project_step):
    report = inspector.inspect(project_step, tree("webapp/", "webapp/src/", "webapp/public", "webapp/src/index.js"))
    assert report["telemetry_active"] is True
    assert report["present"] == ["webapp/src", "webapp/src/index.js"]
    assert report["wrong_type"] == [{"path": "webapp/public", "expected": "directory", "actual": "file"}]
    assert report["missing"] == ["webapp/config", "webapp/public/index.html", "webapp/config/app.conf"]


def test_no_telemetry_means_no_claims(project_step):
    for telemetry in (None, {}, {"ports": [80]}):
        report = inspector.inspect(project_step, telemetry)
        assert report["telemetry_active"] is False
        assert report["missing"] == []


def test_a_truncated_listing_proves_nothing(project_step):
    report = inspector.inspect(project_step, {**tree(), "truncated": True})
    assert report["missing"] == []


def test_paths_deeper_than_the_listing_are_not_called_missing():
    step = {"verificationCommand": "test -f /home/student/a/b/c/d/e.txt && test -d /home/student/a"}
    report = inspector.inspect(step, {**tree(), "maxDepth": 3})
    assert report["missing"] == ["a"]


def test_inspector_never_returns_the_check_or_its_patterns():
    for _unit, _number, step in ALL_STEPS:
        if not step["verificationCommand"]:
            continue
        report = inspector.inspect(step, tree())
        text = repr(report)
        assert step["verificationCommand"] not in text
        assert "grep" not in text and "PASS" not in text
