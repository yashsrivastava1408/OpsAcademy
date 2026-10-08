"""
Every rewritten lab check, proven both ways: it fails on an empty sandbox
and passes once the step's tasks have been done as written.

For each unit one temp HOME is shared by its steps (later steps build on
earlier ones), the simulators are first on PATH, and the commands below are
the ones the step's task text tells the student to type. The check itself
is read from practice.json and run by /bin/sh, with the literal
/home/student replaced by the temp HOME, exactly as the gateway does in
PTY mode.

    python3 -m pytest sandbox-image/tests -q
"""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
BIN = REPO / "sandbox-image" / "bin"
UNITS = REPO / "server" / "data" / "units"
SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
IS_MAC = sys.platform == "darwin"

# The tasks offer `ifconfig` where `ip` is missing, and `netstat` where `ss` is.
INTERFACES = "ip -o addr show" if shutil.which("ip") else "ifconfig"
if shutil.which("ss"):
    LISTENING = "ss -tln"
elif IS_MAC:
    # macOS has neither `ss` nor a `netstat -tln` that lists listeners; this is its
    # equivalent. On Linux (the sandbox image) the command from the task text runs.
    LISTENING = "netstat -an -p tcp"
else:
    LISTENING = "netstat -tln"


def bg(command):
    """A task that starts a background process: its PID is kept so `kill <PID>` can use it and the test can clean up."""
    return {"run": command, "background": True}


def typed(command, stdin):
    """A task that opens an interactive shell: `stdin` is what the student types inside it."""
    return {"run": command, "stdin": stdin}


def wait(seconds):
    return {"wait": seconds}


def capture(name, command):
    """Not a task: reads a value (a pod or bucket name) the student would copy from the screen."""
    return {"capture": name, "run": command}


# The commands of each step, following the task text in practice.json.
# <pod-name>, <PID> and your-bucket-name are filled in the way a student would.
STEPS = {
    "docker-basics": {
        1: ["docker --version", "docker info"],
        2: ["docker pull alpine:latest", "docker run alpine echo 'Hello from Docker!'", "docker ps -a"],
        3: ["docker run -d --name my-webserver -p $WEB_PORT:80 nginx", "docker ps", "curl -s localhost:$WEB_PORT"],
        4: [typed("docker exec -it my-webserver /bin/sh", "cat /etc/nginx/nginx.conf\nexit\n"), "docker logs my-webserver"],
        5: ["mkdir ~/myapp && cd ~/myapp && echo '<h1>Built with OpsAcademy!</h1>' > index.html && "
            "echo 'FROM nginx:alpine' > Dockerfile && echo 'COPY index.html /usr/share/nginx/html/' >> Dockerfile && "
            "docker build -t myapp:v1 . && docker run -d --name myapp -p $APP_PORT:80 myapp:v1",
            "curl -s localhost:$APP_PORT"],
        6: ["docker stats --no-stream", "docker stop my-webserver myapp", "docker rm my-webserver myapp", "docker ps -a"],
    },
    "kubernetes-basics": {
        1: ["kubectl version --client", "kubectl cluster-info", "kubectl get nodes"],
        2: ["kubectl run my-nginx --image=nginx:alpine", "kubectl get pods", "kubectl describe pod my-nginx"],
        3: ["kubectl create deployment web-app --image=nginx:alpine --replicas=3", "kubectl get pods -l app=web-app",
            "kubectl scale deployment web-app --replicas=5"],
        4: ["kubectl expose deployment web-app --port=80 --target-port=80 --type=NodePort", "kubectl get services",
            "kubectl describe service web-app"],
        5: [wait(2.2),  # a real student takes longer than the two seconds the pods need to start
            "kubectl get pods -l app=web-app",
            capture("<pod-name>", "kubectl get pods -l app=web-app -o jsonpath='{.items[0].metadata.name}'"),
            "kubectl logs <pod-name>", typed("kubectl exec -it <pod-name> -- sh", "cat /etc/nginx/nginx.conf\nexit\n"),
            "kubectl top pods"],
        6: ["kubectl delete service web-app", "kubectl delete deployment web-app", "kubectl delete pod my-nginx", "kubectl get all"],
    },
    "aws-cloud-essentials": {
        1: ["aws --version", "aws s3 ls", "aws sts get-caller-identity"],
        2: ["aws s3 mb s3://opsacademy-lab-$(date +%s)", "aws s3 ls",
            capture("your-bucket-name", "aws s3 ls | awk '{print $3}' | head -1"),
            "echo 'Hello Cloud!' > hello.txt", "aws s3 cp hello.txt s3://your-bucket-name/", "aws s3 ls s3://your-bucket-name/"],
        3: ["aws iam list-users",
            "aws iam list-attached-user-policies --user-name $(aws sts get-caller-identity --query 'Arn' --output text | cut -d'/' -f2)",
            "aws iam get-policy-version --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess --version-id v1",
            "aws iam get-policy-version --policy-arn arn:aws:iam::aws:policy/IAMReadOnlyAccess --version-id v1",
            "echo 'AmazonS3FullAccess: every S3 action on every bucket' >> ~/iam-notes.txt",
            "echo 'IAMReadOnlyAccess: read and list IAM, change nothing' >> ~/iam-notes.txt"],
    },
    "networking-fundamentals": {
        1: [INTERFACES, INTERFACES + " > ~/interfaces.txt", "grep 127.0.0.1 ~/interfaces.txt"],
        2: ["cat /etc/resolv.conf", "cat /etc/hosts", "getent hosts localhost", "getent hosts localhost > ~/dns.txt"],
        3: ["mkdir -p ~/site && echo '<h1>Hello from OpsAcademy</h1>' > ~/site/index.html",
            bg("python3 -m http.server $SITE_PORT --bind 127.0.0.1 --directory ~/site > ~/server.log 2>&1 &"),
            "curl -sI http://localhost:$SITE_PORT/", "curl -o /dev/null -s -w '%{http_code}\\n' http://localhost:$SITE_PORT/",
            "curl -s http://localhost:$SITE_PORT/ -o ~/response.html", "cat ~/server.log"],
        4: [LISTENING, LISTENING + " > ~/ports.txt", 'grep "$SITE_PORT" ~/ports.txt', "kill <PID>", wait(0.5),
            "curl -s -m 2 http://localhost:$SITE_PORT/ || echo closed"],
    },
    "linux-basics": {
        1: ["pwd", "ls -la", "ls /", "ls / > ~/root-dirs.txt"],
        2: ["mkdir ~/webapp", "cd ~/webapp && mkdir src public config",
            "cd ~/webapp && touch src/index.js public/index.html config/app.conf"],
        3: ["cd ~/webapp && echo '<html><body><h1>OpsAcademy</h1></body></html>' > public/index.html",
            "cd ~/webapp && echo \"console.log('OpsAcademy');\" > src/index.js",
            "cd ~/webapp && cat public/index.html src/index.js"],
        4: ["cd ~/webapp && chmod +x src/index.js", "cd ~/webapp && chmod 444 config/app.conf", "cd ~/webapp && ls -la src config"],
        5: ["for i in $(seq 1 50); do echo \"Line $i: $([ $((i % 3)) -eq 0 ] && echo ERROR || echo INFO) message\" >> /home/student/app.log; done",
            "grep ERROR app.log | wc -l", "awk '{print $3}' app.log | sort | uniq -c"],
        6: ["ps aux > /dev/null", bg("sleep 300 &"), "ps aux | grep '[s]leep 300' > ~/sleep-proc.txt", "kill <PID>"],
        7: ["echo '#!/bin/bash' > /home/student/heartbeat.sh && echo 'date >> /home/student/heartbeat.log' >> /home/student/heartbeat.sh",
            "chmod +x /home/student/heartbeat.sh", "./heartbeat.sh && cat heartbeat.log"],
    },
}

# The gateway gives every sandbox its lab ports in these variables (8080, 9090
# and 8000 in a container, a private block per shell in PTY mode). Here each
# unit gets three ports that are free on this machine right now.
PORT_NAMES = ("WEB_PORT", "APP_PORT", "SITE_PORT")


def free_ports(count):
    sockets = [socket.socket() for _ in range(count)]
    try:
        for probe in sockets:
            probe.bind(("127.0.0.1", 0))
        return [probe.getsockname()[1] for probe in sockets]
    finally:
        for probe in sockets:
            probe.close()


def port_in_use(port):
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


class Lab:
    """One unit's sandbox: a temp HOME, the env the gateway gives a student, and the processes started in it."""

    def __init__(self, unit, home):
        self.unit = unit
        self.home = str(home)
        self.env = {"HOME": self.home, "PATH": "%s:%s" % (BIN, SYSTEM_PATH), "LANG": "C.UTF-8"}
        self.ports = dict(zip(PORT_NAMES, free_ports(len(PORT_NAMES))))
        self.env.update((name, str(port)) for name, port in self.ports.items())
        self.steps = dict((s["step"], s) for s in json.loads((UNITS / unit / "practice.json").read_text())["steps"])
        self.values = {}
        self.pids = []

    def sh(self, command, stdin=None, background=False):
        """Run one line as /bin/sh would for the student. Output goes to a file so a background job cannot hold a pipe open."""
        command = command.replace("/home/student", self.home)
        for placeholder, value in self.values.items():
            command = command.replace(placeholder, value)
        log_path = os.path.join(self.home, ".test-output")
        with open(log_path, "w") as log:
            result = subprocess.run(["/bin/sh", "-c", command + (" echo $!" if background else "")], input=stdin, env=self.env,
                                    cwd=self.home, stdout=log, stderr=subprocess.STDOUT, universal_newlines=True, timeout=30)
        with open(log_path) as log:
            output = log.read()
        os.unlink(log_path)
        return result.returncode, output

    def do(self, item):
        if isinstance(item, str):
            item = {"run": item}
        if "wait" in item:
            time.sleep(item["wait"])
            return
        code, output = self.sh(item["run"], item.get("stdin"), item.get("background", False))
        assert code == 0, "task command failed (%d): %s\n%s" % (code, item["run"], output)
        if "capture" in item:
            assert output.strip(), "nothing to copy from: %s" % item["run"]
            self.values[item["capture"]] = output.strip()
        if item.get("background"):
            pid = int(output.strip().splitlines()[-1])
            self.pids.append(pid)
            self.values["<PID>"] = str(pid)
            if "http.server" in item["run"]:
                deadline = time.time() + 10
                while not port_in_use(self.ports["SITE_PORT"]) and time.time() < deadline:
                    time.sleep(0.05)

    def check(self, number):
        """Run the step's verification the way the gateway does. Returns True for a pass."""
        verification = self.steps[number]["verification"]
        assert verification["check"] in ("contains", "exact")
        started = time.time()
        _code, output = self.sh(verification["command"])
        assert time.time() - started < 3, "check for step %d took too long" % number
        if verification["check"] == "exact":
            return output.strip() == verification["expectedOutput"]
        return verification["expectedOutput"] in output

    def cleanup(self):
        # Only processes this test started, by PID.
        for pid in self.pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        code, listing = self.sh("docker ps -aq")
        if code == 0 and listing.split():
            self.sh("docker rm -f " + " ".join(listing.split()))


@pytest.fixture(scope="module")
def labs(tmp_path_factory):
    opened = {}

    def get(unit):
        if unit not in opened:
            opened[unit] = Lab(unit, tmp_path_factory.mktemp(unit))
        return opened[unit]

    yield get
    for lab in opened.values():
        lab.cleanup()


CASES = [(unit, number) for unit, steps in STEPS.items() for number in sorted(steps)]


def test_every_step_of_the_edited_units_is_covered():
    for unit, steps in STEPS.items():
        numbers = [s["step"] for s in json.loads((UNITS / unit / "practice.json").read_text())["steps"]]
        assert sorted(steps) == numbers, unit


@pytest.mark.parametrize("unit,number", CASES, ids=["%s#%d" % case for case in CASES])
def test_check_fails_before_the_work_and_passes_after(labs, unit, number):
    lab = labs(unit)
    if unit == "networking-fundamentals" and number == 2 and not shutil.which("getent"):
        pytest.skip("`getent` is a Linux tool: it is in the sandbox image but not on this machine")
    if unit == "networking-fundamentals" and number == 1 and not (shutil.which("ip") or shutil.which("ifconfig")):
        pytest.skip("neither `ip` nor `ifconfig` is installed on this machine")

    assert lab.check(number) is False, "the check passes before any of the step's work is done"
    for item in STEPS[unit][number]:
        lab.do(item)
    assert lab.check(number) is True, "the check still fails after doing the tasks as written"


@pytest.mark.parametrize("unit", list(STEPS))
def test_no_check_passes_on_an_empty_sandbox(tmp_path, unit):
    """The audit's question, asked of every step at once: a fresh HOME where nothing has been done."""
    lab = Lab(unit, tmp_path)
    for number in sorted(lab.steps):
        assert lab.check(number) is False, "%s step %d passes on an empty sandbox" % (unit, number)


def test_task_text_never_reveals_how_a_step_is_checked():
    for unit in STEPS:
        for step in json.loads((UNITS / unit / "practice.json").read_text())["steps"]:
            shown = " ".join([step["title"], step["description"]] + step["tasks"])
            assert "__ran" not in shown and "echo PASS" not in shown, "%s step %d" % (unit, step["step"])
            command = step["verification"]["command"]
            assert "~" not in command and "$HOME" not in command, "%s step %d: use /home/student in checks" % (unit, step["step"])


def test_two_sandboxes_with_different_ports_do_not_disturb_each_other(tmp_path):
    """PTY mode in miniature: two students on one machine, each with their own port variables."""
    first, second = Lab("docker-basics", tmp_path / "a"), Lab("docker-basics", tmp_path / "b")
    try:
        for lab in (first, second):
            os.makedirs(lab.home)
            for item in STEPS["docker-basics"][3]:
                lab.do(item)
        assert first.ports["WEB_PORT"] != second.ports["WEB_PORT"]
        assert first.check(3) and second.check(3)
        # Stopping one student's container leaves the other's running.
        first.do("docker rm -f my-webserver")
        assert first.check(3) is False and second.check(3) is True
    finally:
        first.cleanup()
        second.cleanup()
