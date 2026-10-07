"""
Agent 0: Anti-Abuse Scanner

Two layers:
  1. Rules - known hostile command shapes, checked on the raw command and on
     anything hidden inside base64 or \\x hex. A rule hit is a block.
  2. Isolation Forest - an anomaly score against the commands the labs teach.
     This only flags a command for review; on its own it is far too blunt to
     block on (see evals/run_eval.py for its measured false-positive rate).

The gateway's terminal tripwire (server/lib/commandGuard.js) uses the same
rule set; tests on both sides run the same cases.
"""

import base64
import binascii
import json
import math
import re
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.ensemble import IsolationForest

RULES = [
    ("fork_bomb", r":\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),
    ("fork_bomb", r"(\w+)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1"),
    ("root_delete", r"\brm\s+(?:-[a-zA-Z]+\s+|--[a-z-]+\s+)*/(?:\*|\s|$)"),
    ("root_delete", r"--no-preserve-root"),
    ("disk_fill", r"\bdd\b[^|;&]*\bif=/dev/(?:zero|urandom|random)\b(?![^|;&]*\bcount=)"),
    ("crypto_miner", r"(?i)\b(?:xmrig|minerd|cpuminer|ethminer|nicehash)\b"),
    ("crypto_miner", r"(?i)stratum\+(?:tcp|ssl)://"),
    ("reverse_shell", r"/dev/(?:tcp|udp)/\S+/\d+"),
    ("reverse_shell", r"\b(?:nc|ncat|netcat)\b[^|;&]*\s-[a-zA-Z]*e[a-zA-Z]*\s+\S*sh\b"),
    ("reverse_shell", r"\bmkfifo\b.*\|\s*(?:nc|ncat|netcat)\b"),
    ("host_escape", r"docker\.sock"),
    ("host_escape", r"\bnsenter\b"),
    ("host_escape", r"/proc/sysrq-trigger|\brelease_agent\b|/sys/fs/cgroup/\S*notify_on_release"),
    ("host_escape", r"\bmount\b[^|;&]*\s(?:-t\s+)?(?:proc|sysfs|cgroup2?)\b"),
]

# 8+ characters: long enough to hide `rm -rf /`, short enough that ordinary words rarely decode to text.
BASE64_TOKEN = re.compile(r"[A-Za-z0-9+/]{8,}={0,2}")
# An encoded blob long enough to stand out as a feature for the anomaly model.
LONG_BLOB = re.compile(r"[A-Za-z0-9+/]{24,}={0,2}")
HEX_ESCAPES = re.compile(r"(?:\\x[0-9a-fA-F]{2}){4,}")
PRINTABLE = re.compile(r"^[\x09\x0a\x0d\x20-\x7e]+$")

COMMANDS_PATH = Path(__file__).resolve().parent.parent / "data" / "commands.json"

# Fallback baseline if data/commands.json has not been built.
DEFAULT_BENIGN = [
    "ls -la", "pwd", "cd /home/student", "mkdir -p app/css app/js", "cat README.md",
    "echo '<h1>Hello</h1>' > index.html", "chmod +x deploy.sh", "docker run -d -p 8080:80 nginx",
    "docker ps -a", "kubectl get pods -n kube-system", "git checkout -b feature-login",
    "git commit -m 'Add login page'", "grep -r ERROR /var/log", "terraform plan", "curl -I http://localhost:8080",
]


def load_benign_commands() -> list:
    if COMMANDS_PATH.exists():
        commands = json.loads(COMMANDS_PATH.read_text())
        if len(commands) >= 20:
            return commands
    return DEFAULT_BENIGN


def shannon_entropy(text: str) -> float:
    if not text:
        return 0.0
    counts = Counter(text)
    return -sum((n / len(text)) * math.log2(n / len(text)) for n in counts.values())


def extract_features(command: str) -> list:
    length = max(1, len(command))
    tokens = command.split() or [""]
    return [
        math.log1p(len(command)),
        sum(1 for c in command if not c.isalnum() and not c.isspace()) / length,
        sum(1 for c in command if c.isdigit()) / length,
        shannon_entropy(command),
        math.log1p(max(len(t) for t in tokens)),
        len(re.findall(r"[|;&]", command)),
        1.0 if LONG_BLOB.search(command) or HEX_ESCAPES.search(command) else 0.0,
    ]


class AntiAbuseScanner:
    def __init__(self, benign_commands: list = None):
        self.rules = [(rule_id, re.compile(pattern)) for rule_id, pattern in RULES]
        commands = benign_commands if benign_commands is not None else load_benign_commands()
        self.model = IsolationForest(n_estimators=100, contamination=0.02, random_state=42)
        self.model.fit(np.array([extract_features(c) for c in commands]))

    def deobfuscate(self, command: str) -> list:
        """The command, plus any readable payloads hidden in base64 or \\x hex."""
        parts = [command]

        for token in BASE64_TOKEN.findall(command):
            try:
                decoded = base64.b64decode(token + "=" * (-len(token) % 4)).decode("utf-8")
            except (binascii.Error, UnicodeDecodeError):
                continue
            if PRINTABLE.match(decoded):
                parts.append(decoded)

        for run in HEX_ESCAPES.findall(command):
            decoded = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), run)
            if PRINTABLE.match(decoded):
                parts.append(decoded)

        return parts

    def match_rule(self, command: str):
        """Return (rule_id, was_obfuscated) for the first rule that matches, else None."""
        for index, candidate in enumerate(self.deobfuscate(command)):
            for rule_id, pattern in self.rules:
                if pattern.search(candidate):
                    return rule_id, index > 0
        return None

    def anomaly_score(self, command: str) -> float:
        """Higher means less like the commands the labs teach. Above 0 is flagged."""
        return float(-self.model.decision_function(np.array([extract_features(command)]))[0])

    def scan(self, command: str) -> dict:
        if not command or not command.strip():
            return {"safe": True, "flagged": False, "reason": "Empty command"}

        command = command.strip()
        hit = self.match_rule(command)
        if hit:
            rule_id, obfuscated = hit
            return {
                "safe": False,
                "flagged": True,
                "threat_type": rule_id,
                "reason": f"Matches a blocked command pattern ({rule_id})",
                "action": "BLOCK",
                "deobfuscated": obfuscated,
            }

        score = self.anomaly_score(command)
        if score > 0:
            return {
                "safe": True,
                "flagged": True,
                "threat_type": "anomalous",
                "reason": "Unusual compared with the commands taught in the labs; logged for review",
                "action": "FLAG",
                "anomaly_score": round(score, 4),
            }

        return {"safe": True, "flagged": False, "reason": "Passed security scan", "anomaly_score": round(score, 4)}


scanner = AntiAbuseScanner()
