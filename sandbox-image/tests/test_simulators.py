"""
Tests for the CLI simulators in sandbox-image/bin (docker, kubectl, aws).

Each test runs the real scripts as subprocesses with HOME pointed at a temp
folder, so nothing touches the developer's own state.

    python3 -m pytest sandbox-image/tests -q
"""

import json
import os
import re
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

BIN = Path(__file__).resolve().parent.parent / "bin"
SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"


class Sandbox:
    """A temp home with the simulators first on PATH."""

    def __init__(self, home):
        self.home = Path(home)
        self.env = {"HOME": str(self.home), "PATH": "%s:%s" % (BIN, SYSTEM_PATH), "LANG": "C.UTF-8"}

    def run(self, tool, *args, stdin=None, cwd=None):
        return subprocess.run([str(BIN / tool)] + [str(a) for a in args], input=stdin, env=self.env, cwd=str(cwd or self.home),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=30)

    def sh(self, command):
        return subprocess.run(["/bin/sh", "-c", command], env=self.env, cwd=str(self.home), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True, timeout=30)

    def docker(self, *args, **kwargs):
        return self.run("docker", *args, **kwargs)

    def kubectl(self, *args, **kwargs):
        return self.run("kubectl", *args, **kwargs)

    def aws(self, *args, **kwargs):
        return self.run("aws", *args, **kwargs)


@pytest.fixture
def box(tmp_path):
    sandbox = Sandbox(tmp_path)
    yield sandbox
    # Never leave a web server behind, whatever the test did.
    listing = sandbox.docker("ps", "-aq").stdout.split()
    if listing:
        sandbox.docker("rm", "-f", *listing)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def fetch(port, path="/"):
    with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=5) as response:
        return response.status, dict(response.headers), response.read().decode()


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


# ── Shared behaviour ─────────────────────────────────────────

@pytest.mark.parametrize("tool,args", [
    ("docker", ["info"]), ("docker", ["version"]), ("docker", ["--version"]),
    ("kubectl", ["cluster-info"]), ("kubectl", ["version", "--client"]), ("kubectl", ["version"]),
    ("aws", ["--version"]),
])
def test_tools_say_they_are_simulators(box, tool, args):
    result = box.run(tool, *args)
    assert result.returncode == 0
    assert "OpsAcademy simulator" in result.stdout


@pytest.mark.parametrize("tool,args,named", [
    ("docker", ["swarm", "init"], "'swarm'"), ("kubectl", ["port-forward", "pod/x", "8080:80"], "'port-forward'"),
    ("aws", ["ec2", "describe-instances"], "'ec2 describe-instances'"),
])
def test_unsupported_subcommand_is_refused_clearly(box, tool, args, named):
    result = box.run(tool, *args)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.startswith("%s: %s is not available in the OpsAcademy simulator. Supported: " % (tool, named))


@pytest.mark.parametrize("tool,args,key", [
    ("docker", ["info"], "info"), ("kubectl", ["get", "nodes"], "get-nodes"), ("aws", ["sts", "get-caller-identity"], "sts.get-caller-identity"),
])
def test_ran_check_is_silent_and_tracks_successful_commands(box, tool, args, key):
    before = box.run(tool, "__ran", key)
    assert (before.returncode, before.stdout, before.stderr) == (1, "", "")
    assert box.run(tool, *args).returncode == 0
    after = box.run(tool, "__ran", key)
    assert (after.returncode, after.stdout, after.stderr) == (0, "", "")
    assert box.run(tool, "__ran", "never-ran-this").returncode == 1
    assert box.run(tool, "__ran").returncode == 1


def test_failed_commands_are_not_recorded(box):
    assert box.docker("logs", "ghost").returncode == 1
    assert box.docker("__ran", "logs").returncode == 1
    assert box.kubectl("logs", "ghost").returncode == 1
    assert box.kubectl("__ran", "logs").returncode == 1
    assert box.aws("iam", "list-attached-user-policies").returncode == 252
    assert box.aws("__ran", "iam.list-attached-user-policies").returncode == 1


@pytest.mark.parametrize("tool,args", [("docker", ["ps", "-a"]), ("kubectl", ["get", "pods"]), ("aws", ["s3", "ls"])])
@pytest.mark.parametrize("garbage", ["", "{not json", "[1, 2, 3]", '{"ran": 5, "containers": "x", "pods": 7, "buckets": []}'])
def test_missing_or_corrupt_state_is_tolerated(box, tool, args, garbage):
    folder = box.home / ".opsacademy"
    folder.mkdir()
    (folder / (tool + ".json")).write_text(garbage)
    assert box.run(tool, *args).returncode == 0
    # The file is valid again afterwards and no temp files are left behind.
    assert isinstance(json.loads((folder / (tool + ".json")).read_text()), dict)
    assert not [p for p in folder.iterdir() if p.name.endswith(".tmp")]


# ── docker ───────────────────────────────────────────────────

def test_docker_pull_and_images(box):
    pulled = box.docker("pull", "alpine:latest")
    assert pulled.returncode == 0
    assert "latest: Pulling from library/alpine" in pulled.stdout
    assert "Status: Downloaded newer image for alpine:latest" in pulled.stdout
    assert "Status: Image is up to date for alpine:latest" in box.docker("pull", "alpine").stdout
    lines = box.docker("images").stdout.splitlines()
    assert re.split(r"\s{2,}", lines[0]) == ["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"]
    assert re.match(r"^alpine\s+latest\s+[0-9a-f]{12}\s+.* ago\s+7\.8MB$", lines[1])


def test_docker_pull_unknown_image_fails_like_the_daemon(box):
    result = box.docker("pull", "no-such-image-xyz")
    assert result.returncode == 1
    assert "Error response from daemon: pull access denied for no-such-image-xyz" in result.stderr


def test_docker_run_prints_output_and_leaves_an_exited_container(box):
    result = box.docker("run", "alpine", "echo", "Hello from Docker!")
    assert result.returncode == 0
    assert result.stdout == "Hello from Docker!\n"
    # A missing image is pulled first, as the real client does.
    assert "Unable to find image 'alpine:latest' locally" in result.stderr
    assert box.docker("ps").stdout.count("\n") == 1
    row = box.docker("ps", "-a").stdout.splitlines()[1]
    assert "Exited (0)" in row and "alpine" in row
    assert re.search(r"\s[a-z]+_[a-z]+$", row), "a container without --name gets a random two-word name"
    assert box.docker("logs", row.split()[-1]).stdout == "Hello from Docker!\n"
    assert re.match(r"^[0-9a-f]{12}\n$", box.docker("ps", "-aq").stdout)


def test_docker_run_rm_removes_the_container(box):
    assert box.docker("run", "--rm", "alpine", "echo", "hi").stdout == "hi\n"
    assert box.docker("ps", "-aq").stdout == ""


def test_docker_run_unknown_command_fails(box):
    result = box.docker("run", "alpine", "frobnicate")
    assert result.returncode == 127
    assert 'exec: "frobnicate": executable file not found in $PATH' in result.stderr


def test_docker_detached_nginx_serves_real_http(box):
    port = free_port()
    try:
        started = box.docker("run", "-d", "--name", "web", "-p", "%d:80" % port, "nginx")
        assert started.returncode == 0, started.stderr
        assert re.match(r"^[0-9a-f]{64}\n$", started.stdout)

        status, headers, body = fetch(port)
        assert status == 200
        assert "Welcome to nginx!" in body
        assert "OpsAcademy simulator" in headers["Server"]
        with pytest.raises(urllib.error.HTTPError) as missing:
            fetch(port, "/nope.html")
        assert missing.value.code == 404

        row = box.docker("ps").stdout.splitlines()[1]
        assert "0.0.0.0:%d->80/tcp" % port in row and "Up " in row and row.endswith("web")
        assert box.docker("port", "web", "80").stdout == "0.0.0.0:%d\n" % port
        logs = box.docker("logs", "web").stdout
        assert "ready for start up" in logs and '"GET / HTTP/1.1" 200' in logs and '"GET /nope.html HTTP/1.1" 404' in logs

        # The same host port cannot be published twice.
        clash = box.docker("run", "-d", "--name", "web2", "-p", "%d:80" % port, "nginx")
        assert clash.returncode == 125
        assert "Bind for 0.0.0.0:%d failed: port is already allocated" % port in clash.stderr
        assert "web2" not in box.docker("ps", "-a").stdout

        # Nor can a container name be reused.
        again = box.docker("run", "-d", "--name", "web", "nginx")
        assert again.returncode == 125
        assert 'Conflict. The container name "/web" is already in use' in again.stderr

        refused = box.docker("rm", "web")
        assert refused.returncode == 1
        assert 'cannot remove container "/web": container is running' in refused.stderr

        stopped = box.docker("stop", "web")
        assert stopped.stdout == "web\n"
        assert not port_open(port), "docker stop must kill the web server"
        assert "Exited (0)" in box.docker("ps", "-a").stdout

        assert box.docker("start", "web").returncode == 0
        assert fetch(port)[0] == 200
        assert box.docker("rm", "-f", "web").returncode == 0
        assert not port_open(port), "docker rm -f must kill the web server"
        assert box.docker("ps", "-aq").stdout == ""
    finally:
        box.docker("rm", "-f", "web", "web2")


def test_docker_port_held_by_another_program_is_reported(box):
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]
        try:
            result = box.docker("run", "-d", "--name", "blocked", "-p", "%d:80" % port, "nginx")
            assert result.returncode == 125
            assert "Bind for 0.0.0.0:%d failed: port is already allocated" % port in result.stderr
        finally:
            box.docker("rm", "-f", "blocked")


def test_docker_ps_shows_exited_when_the_server_process_dies(box):
    port = free_port()
    try:
        assert box.docker("run", "-d", "--name", "web", "-p", "%d:80" % port, "nginx").returncode == 0
        pid = int(box.docker("inspect", "-f", "{{.State.Pid}}", "web").stdout)
        assert pid > 0 and alive(pid)
        os.kill(pid, signal.SIGKILL)  # our own child: the PID came from this test's container
        deadline = time.time() + 5
        while port_open(port) and time.time() < deadline:
            time.sleep(0.05)
        assert "web" not in box.docker("ps").stdout
        assert re.search(r"Exited \(137\).*web", box.docker("ps", "-a").stdout)
        exec_result = box.docker("exec", "web", "ls")
        assert exec_result.returncode == 1 and "is not running" in exec_result.stderr
    finally:
        box.docker("rm", "-f", "web")


def test_docker_exec_fake_shell(box):
    port = free_port()
    try:
        box.docker("run", "-d", "--name", "web", "-p", "%d:80" % port, "nginx")
        typed = "\n".join(["pwd", "ls /usr/share/nginx/html", "cat /etc/nginx/nginx.conf", "cd /etc/nginx", "pwd", "ls", "hostname",
                           "whoami", "echo hello world", "env", "ps", "cat /etc/os-release", "cat /etc/hostname", "cat /nope",
                           "vim file.txt", "exit"]) + "\n"
        session = box.docker("exec", "-it", "web", "/bin/sh", stdin=typed)
        assert session.returncode == 0
        out = session.stdout
        assert out.startswith("/ # /\n/ # 50x.html\nindex.html\n")
        assert "worker_connections  1024;" in out
        assert "/etc/nginx # /etc/nginx\n" in out
        assert "conf.d\nmime.types\nnginx.conf\n" in out
        assert "root\n" in out and "hello world\n" in out and "HOSTNAME=" in out
        assert "nginx: master process" in out and "PRETTY_NAME=" in out
        container_id = box.docker("ps", "-q").stdout.strip()
        assert out.count(container_id + "\n") >= 2  # hostname and /etc/hostname
        assert "sh: vim: not found" in session.stderr
        assert "cat: can't open '/nope': No such file or directory" in session.stderr

        # End of input ends the shell cleanly, without an `exit`.
        eof = box.docker("exec", "-it", "web", "sh", stdin="whoami\n")
        assert eof.returncode == 0 and eof.stdout == "/ # root\n/ # \n" and eof.stderr == ""
        assert box.docker("exec", "-it", "web", "bash", stdin="exit 3\n").returncode == 3

        single = box.docker("exec", "web", "cat", "/etc/nginx/nginx.conf")
        assert single.returncode == 0 and "include /etc/nginx/conf.d/*.conf;" in single.stdout and "/ # " not in single.stdout
        assert "Welcome to nginx!" in box.docker("exec", "web", "cat", "/usr/share/nginx/html/index.html").stdout
        missing = box.docker("exec", "web", "htop")
        assert missing.returncode == 126 and 'exec: "htop": executable file not found' in missing.stderr
        ghost = box.docker("exec", "ghost", "ls")
        assert ghost.returncode == 1 and ghost.stderr == "Error response from daemon: No such container: ghost\n"
        assert box.docker("__ran", "exec").returncode == 0
    finally:
        box.docker("rm", "-f", "web")


def test_docker_build_failures(box):
    app = box.home / "app"
    app.mkdir()
    missing = box.docker("build", "-t", "app:v1", ".", cwd=app)
    assert missing.returncode == 1
    assert "Dockerfile: no such file or directory" in missing.stderr

    (app / "Dockerfile").write_text("FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/\n")
    no_source = box.docker("build", "-t", "app:v1", ".", cwd=app)
    assert no_source.returncode == 1
    assert "COPY failed: file not found in build context" in no_source.stderr and "stat index.html" in no_source.stderr
    assert "app" not in box.docker("images").stdout


def test_docker_build_and_serve_custom_page(box):
    app = box.home / "app"
    app.mkdir()
    (app / "index.html").write_text("<h1>Built in a test</h1>\n")
    (app / "Dockerfile").write_text("# my image\nFROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/\nRUN echo done\n")
    built = box.docker("build", "-t", "app:v1", ".", cwd=app)
    assert built.returncode == 0, built.stderr
    for expected in ("Step 1/3 : FROM nginx:alpine", "Step 2/3 : COPY index.html /usr/share/nginx/html/",
                     "Step 3/3 : RUN echo done", "Successfully tagged app:v1"):
        assert expected in built.stdout
    assert re.search(r"(?m)^app\s+v1\s+[0-9a-f]{12}", box.docker("images").stdout)

    port = free_port()
    try:
        assert box.docker("run", "-d", "--name", "app", "-p", "%d:80" % port, "app:v1").returncode == 0
        assert fetch(port)[2] == "<h1>Built in a test</h1>\n"
        assert box.docker("exec", "app", "cat", "/usr/share/nginx/html/index.html").stdout == "<h1>Built in a test</h1>\n"
        in_use = box.docker("rmi", "app:v1")
        assert in_use.returncode == 1 and "conflict: unable to remove repository reference" in in_use.stderr
        stats = box.docker("stats", "--no-stream").stdout.splitlines()
        assert stats[0].startswith("CONTAINER ID   NAME") and "MEM USAGE / LIMIT" in stats[0]
        assert len(stats) == 2 and " app " in stats[1]
        inspected = json.loads(box.docker("inspect", "app").stdout)[0]
        assert inspected["State"]["Running"] is True and inspected["Name"] == "/app"
        assert inspected["NetworkSettings"]["Ports"]["80/tcp"][0]["HostPort"] == str(port)
    finally:
        box.docker("rm", "-f", "app")
    assert not port_open(port)
    assert box.docker("rmi", "app:v1").returncode == 0


def test_docker_rm_and_missing_objects(box):
    box.docker("run", "--name", "once", "alpine", "echo", "x")
    missing = box.docker("rm", "ghost")
    assert missing.returncode == 1 and missing.stderr == "Error response from daemon: No such container: ghost\n"
    assert box.docker("rm", "once").stdout == "once\n"
    assert box.docker("__ran", "rm:once").returncode == 0
    assert box.docker("__ran", "rm:ghost").returncode == 1
    assert box.docker("inspect", "ghost").returncode == 1
    assert box.docker("stop", "ghost").returncode == 1


# ── kubectl ──────────────────────────────────────────────────

def pod_names(box, selector="app=web"):
    return box.kubectl("get", "pods", "-l", selector, "-o", "jsonpath={.items[*].metadata.name}").stdout.split()


def test_kubectl_nodes_and_empty_namespace(box):
    nodes = box.kubectl("get", "nodes").stdout.splitlines()
    assert nodes[0].split() == ["NAME", "STATUS", "ROLES", "AGE", "VERSION"]
    assert nodes[1].split()[1:3] == ["Ready", "control-plane"]
    empty = box.kubectl("get", "pods")
    assert empty.returncode == 0 and empty.stdout == "" and empty.stderr == "No resources found in default namespace.\n"
    assert "kube-system" in box.kubectl("get", "namespaces").stdout
    assert "coredns" in box.kubectl("get", "pods", "-n", "kube-system").stdout
    assert box.kubectl("get", "pods", "-A").stdout.splitlines()[0].split()[0] == "NAMESPACE"
    unknown = box.kubectl("get", "widgets")
    assert unknown.returncode == 1 and 'the server doesn\'t have a resource type "widgets"' in unknown.stderr


def test_kubectl_pod_starts_as_container_creating_then_runs(box):
    assert box.kubectl("run", "my-nginx", "--image=nginx:alpine").stdout == "pod/my-nginx created\n"
    row = box.kubectl("get", "pods").stdout.splitlines()[1].split()
    assert row[:4] == ["my-nginx", "0/1", "ContainerCreating", "0"]
    assert box.kubectl("get", "pod", "my-nginx", "-o", "jsonpath={.status.phase}").stdout == "Pending"
    early = box.kubectl("logs", "my-nginx")
    assert early.returncode == 1 and "is waiting to start: ContainerCreating" in early.stderr
    duplicate = box.kubectl("run", "my-nginx", "--image=nginx")
    assert duplicate.returncode == 1 and 'pods "my-nginx" already exists' in duplicate.stderr

    time.sleep(2.2)
    assert box.kubectl("get", "po").stdout.splitlines()[1].split()[:3] == ["my-nginx", "1/1", "Running"]
    assert box.kubectl("get", "pod", "my-nginx", "-o", "jsonpath={.status.phase}").stdout == "Running"
    described = box.kubectl("describe", "pod", "my-nginx").stdout
    assert "Name:             my-nginx" in described and "Image:          nginx:alpine" in described and "Events:" in described
    assert "ready for start up" in box.kubectl("logs", "my-nginx").stdout

    session = box.kubectl("exec", "-it", "my-nginx", "--", "sh", stdin="cat /etc/nginx/nginx.conf\nhostname\nexit\n")
    assert session.returncode == 0
    assert session.stdout.startswith("/ # ") and "worker_processes  auto;" in session.stdout and "my-nginx\n" in session.stdout
    assert box.kubectl("exec", "my-nginx", "--", "whoami").stdout == "root\n"
    assert box.kubectl("exec", "-it", "my-nginx", "--", "sh", stdin="").returncode == 0

    top = box.kubectl("top", "pods").stdout.splitlines()
    assert top[0].split() == ["NAME", "CPU(cores)", "MEMORY(bytes)"] and top[1].startswith("my-nginx")
    assert "CPU%" in box.kubectl("top", "nodes").stdout
    for key in ("logs", "exec", "top-pods", "top-nodes", "describe-pod"):
        assert box.kubectl("__ran", key).returncode == 0, key

    assert box.kubectl("delete", "pod", "my-nginx").stdout == 'pod "my-nginx" deleted\n'
    gone = box.kubectl("get", "pod", "my-nginx")
    assert gone.returncode == 1 and gone.stderr == 'Error from server (NotFound): pods "my-nginx" not found\n'


def test_kubectl_deployment_scaling_self_healing_and_jsonpath(box):
    created = box.kubectl("create", "deployment", "web", "--image=nginx:alpine", "--replicas=3")
    assert created.stdout == "deployment.apps/web created\n"
    names = pod_names(box)
    assert len(names) == 3 and len(set(names)) == 3
    assert all(re.match(r"^web-[0-9a-f]{10}-[a-z0-9]{5}$", name) for name in names)

    assert box.kubectl("scale", "deployment", "web", "--replicas=5").stdout == "deployment.apps/web scaled\n"
    assert len(pod_names(box)) == 5
    assert box.kubectl("get", "deployment", "web", "-o", "jsonpath={.spec.replicas}").stdout == "5"
    first = box.kubectl("get", "pods", "-l", "app=web", "-o", "jsonpath={.items[0].metadata.name}").stdout
    assert first == sorted(pod_names(box))[0]
    assert pod_names(box, "app=other") == []
    out_of_range = box.kubectl("get", "pods", "-l", "app=other", "-o", "jsonpath={.items[0].metadata.name}")
    assert out_of_range.returncode == 1 and "array index out of bounds" in out_of_range.stderr

    listing = json.loads(box.kubectl("get", "pods", "-o", "json").stdout)
    assert listing["kind"] == "List" and len(listing["items"]) == 5
    assert listing["items"][0]["metadata"]["labels"]["app"] == "web"
    assert listing["items"][0]["spec"]["containers"][0]["image"] == "nginx:alpine"
    deployment = json.loads(box.kubectl("get", "deploy", "web", "-o", "json").stdout)
    assert deployment["kind"] == "Deployment" and deployment["spec"]["selector"]["matchLabels"] == {"app": "web"}
    assert box.kubectl("get", "deployment", "web", "-o", "name").stdout == "deployment.apps/web\n"
    assert "IP" in box.kubectl("get", "pods", "-o", "wide").stdout.splitlines()[0]
    assert "replicas: 5" in box.kubectl("get", "deployment", "web", "-o", "yaml").stdout

    # Self-healing: a deleted pod is replaced by a new one with a different name.
    victim = pod_names(box)[0]
    assert box.kubectl("delete", "pod", victim).stdout == 'pod "%s" deleted\n' % victim
    after = pod_names(box)
    assert len(after) == 5 and victim not in after

    box.kubectl("scale", "deployment/web", "--replicas=2")
    assert len(pod_names(box)) == 2
    time.sleep(2.2)
    assert box.kubectl("get", "deployments").stdout.splitlines()[1].split()[:4] == ["web", "2/2", "2", "2"]

    exposed = box.kubectl("expose", "deployment", "web", "--port=80", "--target-port=80", "--type=NodePort")
    assert exposed.stdout == "service/web exposed\n"
    service_row = [line for line in box.kubectl("get", "services").stdout.splitlines() if line.startswith("web ")][0].split()
    assert service_row[1] == "NodePort" and re.match(r"^80:3\d{4}/TCP$", service_row[4])
    assert box.kubectl("get", "svc", "web", "-o", "jsonpath={.spec.type}").stdout == "NodePort"
    described = box.kubectl("describe", "service", "web").stdout
    assert "Selector:                 app=web" in described and "NodePort:" in described and ":80" in described
    everything = box.kubectl("get", "all").stdout
    for expected in ("pod/web-", "service/kubernetes", "service/web", "deployment.apps/web", "replicaset.apps/web-"):
        assert expected in everything

    assert box.kubectl("delete", "service", "web").stdout == 'service "web" deleted\n'
    assert box.kubectl("delete", "deployment", "web").stdout == 'deployment.apps "web" deleted\n'
    assert pod_names(box) == []
    missing = box.kubectl("get", "deployment", "web")
    assert missing.returncode == 1 and missing.stderr == 'Error from server (NotFound): deployments.apps "web" not found\n'
    assert box.kubectl("delete", "deployment", "web").returncode == 1
    assert box.kubectl("__ran", "delete-deployment:web").returncode == 0
    assert box.kubectl("__ran", "delete-deployment:other").returncode == 1


def test_kubectl_apply_and_delete_from_a_file(box):
    manifest = box.home / "app.yaml"
    manifest.write_text("""apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: nginx:1.27
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: NodePort
  selector:
    app: api
  ports:
  - port: 8080
    targetPort: 80
---
apiVersion: v1
kind: Pod
metadata:
  name: lonely
spec:
  containers:
  - name: main
    image: "busybox:1.36"
""")
    applied = box.kubectl("apply", "-f", manifest)
    assert applied.stdout == "deployment.apps/api created\nservice/api created\npod/lonely created\n"
    assert len(pod_names(box, "app=api")) == 2
    assert box.kubectl("get", "deployment", "api", "-o", "jsonpath={.spec.template.spec.containers[0].image}").stdout == "nginx:1.27"
    assert box.kubectl("get", "svc", "api", "-o", "jsonpath={.spec.ports[0].port}").stdout == "8080"
    assert box.kubectl("get", "pod", "lonely", "-o", "jsonpath={.spec.containers[0].image}").stdout == "busybox:1.36"
    assert box.kubectl("apply", "-f", manifest).stdout == "deployment.apps/api unchanged\nservice/api unchanged\npod/lonely unchanged\n"

    manifest.write_text(manifest.read_text().replace("replicas: 2", "replicas: 4"))
    assert "deployment.apps/api configured" in box.kubectl("apply", "-f", manifest).stdout
    assert len(pod_names(box, "app=api")) == 4

    deleted = box.kubectl("delete", "-f", manifest)
    assert deleted.stdout == 'deployment.apps "api" deleted\nservice "api" deleted\npod "lonely" deleted\n'
    assert "api" not in box.kubectl("get", "all").stdout
    nowhere = box.kubectl("apply", "-f", box.home / "missing.yaml")
    assert nowhere.returncode == 1 and "does not exist" in nowhere.stderr


# ── aws ──────────────────────────────────────────────────────

def test_aws_identity_and_iam(box):
    identity = json.loads(box.aws("sts", "get-caller-identity").stdout)
    assert identity["Account"] == "123456789012" and identity["Arn"] == "arn:aws:iam::123456789012:user/student"
    users = json.loads(box.aws("iam", "list-users").stdout)["Users"]
    assert users[0]["UserName"] == "student" and {"Arn", "UserId", "CreateDate", "Path"} <= set(users[0])
    assert json.loads(box.aws("iam", "get-user").stdout)["User"]["UserName"] == "student"
    policies = json.loads(box.aws("iam", "list-attached-user-policies", "--user-name", "student").stdout)["AttachedPolicies"]
    assert len(policies) == 2
    assert {"PolicyName": "AmazonS3FullAccess", "PolicyArn": "arn:aws:iam::aws:policy/AmazonS3FullAccess"} in policies
    document = json.loads(box.aws("iam", "get-policy-version", "--policy-arn", policies[0]["PolicyArn"], "--version-id", "v1").stdout)
    assert document["PolicyVersion"]["Document"]["Statement"][0]["Effect"] == "Allow"

    no_name = box.aws("iam", "list-attached-user-policies")
    assert no_name.returncode == 252 and "the following arguments are required: --user-name" in no_name.stderr
    stranger = box.aws("iam", "get-user", "--user-name", "mallory")
    assert stranger.returncode == 254
    assert "An error occurred (NoSuchEntity) when calling the GetUser operation" in stranger.stderr
    configured = box.aws("configure", "list")
    assert configured.returncode == 0 and "region" in configured.stdout and "us-east-1" in configured.stdout


def test_aws_query_and_output(box):
    assert json.loads(box.aws("sts", "get-caller-identity", "--query", "Arn").stdout) == "arn:aws:iam::123456789012:user/student"
    assert box.aws("sts", "get-caller-identity", "--query", "Arn", "--output", "text").stdout == "arn:aws:iam::123456789012:user/student\n"
    assert box.aws("sts", "get-caller-identity", "--query=Account", "--output=text").stdout == "123456789012\n"
    assert box.aws("iam", "get-user", "--query", "User.UserName", "--output", "text").stdout == "student\n"
    assert box.aws("iam", "list-users", "--query", "Users[0].Arn", "--output", "text").stdout == "arn:aws:iam::123456789012:user/student\n"
    assert json.loads(box.aws("iam", "list-users", "--query", "Users[*].UserName").stdout) == ["student", "ci-deployer"]
    assert box.aws("iam", "list-users", "--query", "Users[*].UserName", "--output", "text").stdout == "student\tci-deployer\n"
    assert box.aws("iam", "list-users", "--query", "Nope", "--output", "text").stdout == "None\n"
    assert box.aws("iam", "list-users", "--query", "Nope").stdout == "null\n"
    assert box.aws("iam", "list-users", "--output", "text").stdout.startswith("USERS\t")
    bad = box.aws("iam", "list-users", "--query", "Users[?UserName=='x']")
    assert bad.returncode == 255 and "Bad value for --query" in bad.stderr

    # The exact command the lab asks for.
    lab = box.sh("aws iam list-attached-user-policies --user-name $(aws sts get-caller-identity --query 'Arn' --output text | cut -d'/' -f2)")
    assert lab.returncode == 0, lab.stderr
    assert [p["PolicyName"] for p in json.loads(lab.stdout)["AttachedPolicies"]] == ["AmazonS3FullAccess", "IAMReadOnlyAccess"]
    assert box.aws("__ran", "iam.list-attached-user-policies").returncode == 0


@pytest.mark.parametrize("name", [
    "ab", "a" * 64, "My-Bucket", "under_score", "-leading", "trailing-", "two..dots", "192.168.1.10",
    "xn--punycode", "sthree-thing", "thing-s3alias", "thing--ol-s3", "has space",
])
def test_aws_rejects_invalid_bucket_names(box, name):
    result = box.aws("s3", "mb", "s3://" + name)
    assert result.returncode == 1
    assert "An error occurred (InvalidBucketName) when calling the CreateBucket operation" in result.stderr
    assert box.aws("s3", "ls").stdout == ""


@pytest.mark.parametrize("name", ["abc", "a" * 63, "my.bucket-1", "opsacademy-lab-1700000000", "0start9"])
def test_aws_accepts_valid_bucket_names(box, name):
    assert box.aws("s3", "mb", "s3://" + name).stdout == "make_bucket: %s\n" % name


def test_aws_s3_round_trip(box):
    assert box.aws("s3", "ls").stdout == ""
    assert box.aws("s3", "mb", "s3://opsacademy-test").returncode == 0
    twice = box.aws("s3", "mb", "s3://opsacademy-test")
    assert twice.returncode == 1 and "BucketAlreadyOwnedByYou" in twice.stderr
    assert re.match(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d opsacademy-test\n$", box.aws("s3", "ls").stdout)

    (box.home / "hello.txt").write_bytes(b"Hello Cloud!\n")
    assert box.aws("s3", "cp", "hello.txt", "s3://opsacademy-test/").stdout == "upload: ./hello.txt to s3://opsacademy-test/hello.txt\n"
    assert box.aws("s3", "cp", "hello.txt", "s3://opsacademy-test/docs/copy.txt").returncode == 0
    listing = box.aws("s3", "ls", "s3://opsacademy-test/").stdout
    assert re.search(r"(?m)^ +PRE docs/$", listing)
    assert re.search(r"(?m)^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d +13 hello\.txt$", listing)
    assert "docs/copy.txt" in box.aws("s3", "ls", "s3://opsacademy-test", "--recursive").stdout

    down = box.aws("s3", "cp", "s3://opsacademy-test/docs/copy.txt", "back.txt")
    assert down.stdout == "download: s3://opsacademy-test/docs/copy.txt to ./back.txt\n"
    assert (box.home / "back.txt").read_bytes() == b"Hello Cloud!\n"
    assert box.aws("s3", "cp", "s3://opsacademy-test/hello.txt", "-").stdout == "Hello Cloud!\n"

    no_file = box.aws("s3", "cp", "ghost.txt", "s3://opsacademy-test/")
    assert no_file.returncode == 255 and "The user-provided path ghost.txt does not exist." in no_file.stderr
    no_key = box.aws("s3", "cp", "s3://opsacademy-test/ghost.txt", "x.txt")
    assert no_key.returncode == 1 and 'Key "ghost.txt" does not exist' in no_key.stderr
    no_bucket = box.aws("s3", "ls", "s3://opsacademy-ghost")
    assert no_bucket.returncode == 254 and "An error occurred (NoSuchBucket)" in no_bucket.stderr

    (box.home / "big.bin").write_bytes(b"x" * (1024 * 1024 + 1))
    too_big = box.aws("s3", "cp", "big.bin", "s3://opsacademy-test/")
    assert too_big.returncode == 1 and "limited to 1 MB" in too_big.stderr
    assert "big.bin" not in box.aws("s3", "ls", "s3://opsacademy-test/").stdout

    not_empty = box.aws("s3", "rb", "s3://opsacademy-test")
    assert not_empty.returncode == 1 and "BucketNotEmpty" in not_empty.stderr
    assert box.aws("s3", "rm", "s3://opsacademy-test/hello.txt").stdout == "delete: s3://opsacademy-test/hello.txt\n"
    forced = box.aws("s3", "rb", "s3://opsacademy-test", "--force")
    assert forced.stdout == "delete: s3://opsacademy-test/docs/copy.txt\nremove_bucket: opsacademy-test\n"
    assert box.aws("s3", "ls").stdout == ""
    for key in ("s3.ls", "s3.mb", "s3.cp", "s3.rm", "s3.rb"):
        assert box.aws("__ran", key).returncode == 0, key
