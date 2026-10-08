"""
Shared helpers for the OpsAcademy CLI simulators (docker, kubectl, aws).

The sandbox has no network and no container runtime, so these three tools
are simulated: they keep their state in a small JSON file per student and
print what the real tools would print. They never pretend to be the real
thing: version and info output says "OpsAcademy simulator".

Standard library only. Must run on Python 3.9+ (Alpine and macOS).
"""

import hashlib
import json
import os
import shlex
import sys
import tempfile
import time

SIM_NAME = "OpsAcademy simulator"


# ── State ────────────────────────────────────────────────────

def state_dir():
    """Folder holding this student's simulator state. Created on demand."""
    home = os.environ.get("HOME") or os.path.expanduser("~")
    path = os.path.join(home, ".opsacademy")
    os.makedirs(path, exist_ok=True)
    return path


def load_state(tool, default):
    """Read <tool>.json. A missing or damaged file gives a fresh state."""
    state = json.loads(json.dumps(default))
    try:
        with open(os.path.join(state_dir(), tool + ".json")) as handle:
            saved = json.load(handle)
        if isinstance(saved, dict):
            for key, value in saved.items():
                # Keep the default when a saved field has the wrong shape.
                if key not in state or isinstance(value, type(state[key])):
                    state[key] = value
    except (OSError, ValueError):
        pass
    return state


def save_state(tool, state):
    """Write the state through a temp file so a crash never leaves half a file."""
    folder = state_dir()
    handle, temp_path = tempfile.mkstemp(dir=folder, prefix="." + tool + "-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w") as out:
            json.dump(state, out)
        os.replace(temp_path, os.path.join(folder, tool + ".json"))
    except OSError:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def record(state, *keys):
    """Remember that these subcommands were handled successfully."""
    ran = state.setdefault("ran", {})
    for key in keys:
        if key:
            ran[key] = ran.get(key, 0) + 1


def ran_check(state, args):
    """`TOOL __ran KEY`: exit 0 if that subcommand has been run, else 1. Prints nothing."""
    return 0 if args and state.get("ran", {}).get(args[0], 0) > 0 else 1


def unsupported(tool, name, supported):
    sys.stderr.write("%s: '%s' is not available in the %s. Supported: %s\n" % (tool, name, SIM_NAME, ", ".join(supported)))
    return 1


def run(main):
    """Call a simulator's main() and exit with its code."""
    try:
        code = main(sys.argv[1:])
        sys.stdout.flush()
    except BrokenPipeError:
        # The reader went away (`docker ps | head -1`): not an error.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        code = 0
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


# ── Output helpers ───────────────────────────────────────────

def table(headers, rows, gap=3):
    """A left-aligned column table like `docker ps` and `kubectl get` print."""
    widths = [len(h) for h in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(str(cell)))
    lines = []
    for row in [headers] + [list(r) for r in rows]:
        cells = [str(cell).ljust(widths[index] + gap) for index, cell in enumerate(row)]
        lines.append("".join(cells).rstrip())
    return "\n".join(lines)


def hex_id(seed, length=64):
    """A stable hex string for a seed, used for image and layer IDs."""
    digest = hashlib.sha256(str(seed).encode()).hexdigest()
    while len(digest) < length:
        digest += hashlib.sha256(digest.encode()).hexdigest()
    return digest[:length]


def human_duration(seconds):
    """Docker-style age: '5 seconds', 'About a minute', '3 hours'."""
    seconds = max(0, int(seconds))
    if seconds < 1:
        return "Less than a second"
    if seconds < 60:
        return "%d second%s" % (seconds, "" if seconds == 1 else "s")
    minutes = seconds // 60
    if minutes == 1:
        return "About a minute"
    if minutes < 60:
        return "%d minutes" % minutes
    hours = minutes // 60
    if hours == 1:
        return "About an hour"
    if hours < 48:
        return "%d hours" % hours
    return "%d days" % (hours // 24)


def k8s_age(seconds):
    """kubectl-style age: '5s', '2m10s', '3h', '4d'."""
    seconds = max(0, int(seconds))
    if seconds < 120:
        return "%ds" % seconds
    minutes = seconds // 60
    if minutes < 10:
        rest = seconds % 60
        return "%dm%ds" % (minutes, rest) if rest else "%dm" % minutes
    if minutes < 180:
        return "%dm" % minutes
    hours = minutes // 60
    if hours < 8:
        rest = minutes % 60
        return "%dh%dm" % (hours, rest) if rest else "%dh" % hours
    if hours < 48:
        return "%dh" % hours
    return "%dd" % (hours // 24)


# ── Files inside a simulated container ───────────────────────

NGINX_VERSION = "1.27.0"

NGINX_WELCOME = """<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
"""

NGINX_50X = """<!DOCTYPE html>
<html>
<head>
<title>Error</title>
</head>
<body>
<h1>An error occurred.</h1>
<p>Sorry, the page you are looking for is currently unavailable.<br/>
Please try again later.</p>
</body>
</html>
"""

NGINX_CONF = """
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log notice;
pid        /var/run/nginx.pid;


events {
    worker_connections  1024;
}


http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    #tcp_nopush     on;

    keepalive_timeout  65;

    #gzip  on;

    include /etc/nginx/conf.d/*.conf;
}
"""

NGINX_DEFAULT_CONF = """server {
    listen       80;
    listen  [::]:80;
    server_name  localhost;

    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }

    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
"""

OS_RELEASE = {
    "alpine": 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20.3\nPRETTY_NAME="Alpine Linux v3.20"\n'
              'HOME_URL="https://alpinelinux.org/"\nBUG_REPORT_URL="https://gitlab.alpinelinux.org/alpine/aports/-/issues"\n',
    "debian": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\n'
              'VERSION="12 (bookworm)"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL="https://www.debian.org/"\n',
    "ubuntu": 'PRETTY_NAME="Ubuntu 24.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04 LTS (Noble Numbat)"\n'
              'VERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n',
}

EMPTY_DIRS = ["/bin", "/dev", "/etc", "/home", "/lib", "/media", "/mnt", "/opt", "/proc", "/root",
              "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/usr/bin", "/usr/local", "/var", "/var/log"]


def container_files(hostname, os_name="alpine", nginx=False, extra_html=None):
    """The readable files of a simulated container: {absolute path: text}."""
    files = {
        "/etc/os-release": OS_RELEASE.get(os_name, OS_RELEASE["alpine"]),
        "/etc/hostname": hostname + "\n",
        "/etc/hosts": "127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\n172.17.0.2\t%s\n" % hostname,
        "/etc/resolv.conf": "nameserver 10.96.0.10\nsearch default.svc.cluster.local svc.cluster.local cluster.local\noptions ndots:5\n",
        "/etc/passwd": "root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/:/sbin/nologin\n",
    }
    if nginx:
        files["/etc/passwd"] += "nginx:x:101:101:nginx:/var/cache/nginx:/sbin/nologin\n"
        files["/etc/nginx/nginx.conf"] = NGINX_CONF
        files["/etc/nginx/conf.d/default.conf"] = NGINX_DEFAULT_CONF
        files["/etc/nginx/mime.types"] = "types {\n    text/html  html htm shtml;\n    text/css  css;\n    application/javascript  js;\n    image/png  png;\n}\n"
        files["/usr/share/nginx/html/index.html"] = NGINX_WELCOME
        files["/usr/share/nginx/html/50x.html"] = NGINX_50X
        files["/docker-entrypoint.sh"] = "#!/bin/sh\n# vim:sw=4:ts=4:et\n\nset -e\n\nexec \"$@\"\n"
        files["/var/log/nginx/access.log"] = ""
        files["/var/log/nginx/error.log"] = ""
        for name, text in (extra_html or {}).items():
            files["/usr/share/nginx/html/" + name.lstrip("/")] = text
    return files


# ── The fake shell ───────────────────────────────────────────

class ShellExit(Exception):
    def __init__(self, code):
        Exception.__init__(self)
        self.code = code


class FakeShell(object):
    """
    A tiny read-only shell for `docker exec` and `kubectl exec`.

    It knows a handful of commands and a small set of files. Anything else
    answers "sh: X: not found", the way a minimal container image would.
    """

    SHELL_NAMES = ("sh", "/bin/sh", "bash", "/bin/bash", "ash", "/bin/ash")

    def __init__(self, hostname, files, env=None, processes=None):
        self.hostname = hostname
        self.files = files
        self.cwd = "/"
        self.env = {
            "HOSTNAME": hostname,
            "HOME": "/root",
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        }
        self.env.update(env or {})
        self.processes = processes or []
        self.out = sys.stdout
        self.err = sys.stderr

    # Paths

    def resolve(self, path):
        if not path.startswith("/"):
            path = self.cwd.rstrip("/") + "/" + path
        parts = []
        for part in path.split("/"):
            if part in ("", "."):
                continue
            if part == "..":
                if parts:
                    parts.pop()
            else:
                parts.append(part)
        return "/" + "/".join(parts)

    def is_dir(self, path):
        if path == "/" or path in EMPTY_DIRS:
            return True
        prefix = path.rstrip("/") + "/"
        return any(name.startswith(prefix) for name in self.files)

    def children(self, path):
        prefix = "/" if path == "/" else path + "/"
        names = set()
        for name in list(self.files) + EMPTY_DIRS:
            if name.startswith(prefix) and name != path:
                names.add(name[len(prefix):].split("/")[0])
        return sorted(names)

    # Commands

    def cmd_ls(self, args):
        flags = "".join(a[1:] for a in args if a.startswith("-") and len(a) > 1)
        paths = [a for a in args if not a.startswith("-")] or ["."]
        code = 0
        for index, raw in enumerate(paths):
            path = self.resolve(raw)
            if path in self.files:
                names, base = [raw], None
            elif self.is_dir(path):
                names, base = self.children(path), path
                if "a" in flags:
                    names = [".", ".."] + names
            else:
                self.err.write("ls: %s: No such file or directory\n" % raw)
                code = 1
                continue
            if len(paths) > 1 and base is not None:
                self.out.write("%s%s:\n" % ("\n" if index else "", raw))
            if "l" in flags:
                for name in names:
                    full = self.resolve(name) if base is None else self.resolve(base + "/" + name)
                    if full in self.files:
                        self.out.write("-rw-r--r--    1 root     root     %8d Oct  7 09:00 %s\n" % (len(self.files[full]), name))
                    else:
                        self.out.write("drwxr-xr-x    1 root     root         4096 Oct  7 09:00 %s\n" % name)
            elif names:
                # One name per line when piped, a single row on a terminal.
                self.out.write(("  " if self.out.isatty() and "1" not in flags else "\n").join(names) + "\n")
        return code

    def cmd_cat(self, args):
        code = 0
        for raw in [a for a in args if not a.startswith("-")]:
            path = self.resolve(raw)
            if path in self.files:
                text = self.files[path]
                self.out.write(text)
            elif self.is_dir(path):
                self.err.write("cat: read error: Is a directory\n")
                code = 1
            else:
                self.err.write("cat: can't open '%s': No such file or directory\n" % raw)
                code = 1
        return code

    def cmd_cd(self, args):
        target = self.resolve(args[0] if args else self.env["HOME"])
        if target in self.files:
            self.err.write("sh: cd: can't cd to %s: Not a directory\n" % args[0])
            return 1
        if not self.is_dir(target):
            self.err.write("sh: cd: can't cd to %s: No such file or directory\n" % args[0])
            return 2
        self.cwd = target
        return 0

    def cmd_ps(self, _args):
        self.out.write("PID   USER     TIME  COMMAND\n")
        rows = list(self.processes) + [("root", "sh"), ("root", "ps")]
        pid = 1
        for user, command in rows:
            self.out.write("%5d %-8s  0:00 %s\n" % (pid, user, command))
            pid += 28 if pid == 1 else 7
        return 0

    def cmd_nginx(self, args):
        if "-v" in args or "-V" in args:
            self.err.write("nginx version: nginx/%s\n" % NGINX_VERSION)
        elif "-t" in args:
            self.err.write("nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n"
                           "nginx: configuration file /etc/nginx/nginx.conf test is successful\n")
        else:
            self.err.write("nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\n")
            return 1
        return 0

    def run_command(self, words):
        """Run one already-split command. Returns its exit code."""
        if not words:
            return 0
        name, args = words[0], words[1:]
        if name == "exit":
            code = int(args[0]) if args and args[0].lstrip("-").isdigit() else 0
            raise ShellExit(code)
        if name == "ls":
            return self.cmd_ls(args)
        if name == "cat":
            return self.cmd_cat(args)
        if name == "cd":
            return self.cmd_cd(args)
        if name == "pwd":
            self.out.write(self.cwd + "\n")
        elif name == "hostname":
            self.out.write(self.hostname + "\n")
        elif name == "whoami":
            self.out.write("root\n")
        elif name == "id":
            self.out.write("uid=0(root) gid=0(root) groups=0(root)\n")
        elif name == "echo":
            newline = not (args and args[0] == "-n")
            self.out.write(" ".join(args[0 if newline else 1:]) + ("\n" if newline else ""))
        elif name in ("env", "printenv"):
            env = dict(self.env, PWD=self.cwd)
            if name == "printenv" and args:
                if args[0] not in env:
                    return 1
                self.out.write(env[args[0]] + "\n")
            else:
                for key in sorted(env):
                    self.out.write("%s=%s\n" % (key, env[key]))
        elif name == "ps":
            return self.cmd_ps(args)
        elif name == "uname":
            self.out.write(("Linux %s 6.6.0 #1 SMP x86_64 Linux\n" % self.hostname) if "-a" in args else "Linux\n")
        elif name == "date":
            self.out.write(time.strftime("%a %b %e %H:%M:%S UTC %Y\n", time.gmtime()))
        elif name in ("true", ":"):
            return 0
        elif name == "false":
            return 1
        elif name == "nginx" and "/etc/nginx/nginx.conf" in self.files:
            return self.cmd_nginx(args)
        else:
            self.err.write("sh: %s: not found\n" % name)
            return 127
        return 0

    def can_run(self, name):
        known = ("exit", "ls", "cat", "cd", "pwd", "hostname", "whoami", "id", "echo", "env", "printenv",
                 "ps", "uname", "date", "true", ":", "false")
        return name in known or (name == "nginx" and "/etc/nginx/nginx.conf" in self.files)

    def run_line(self, line):
        """Run one typed line, which may chain commands with ';' or '&&'."""
        try:
            lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
            lexer.whitespace_split = True
            tokens = list(lexer)
        except ValueError:
            self.err.write("sh: syntax error: unterminated quoted string\n")
            return 2
        code, words, skip = 0, [], False
        for token in tokens + [";"]:
            if token in (";", "&&"):
                if words and not skip:
                    code = self.run_command(words)
                words, skip = [], (token == "&&" and code != 0)
            elif token and all(ch in "|&<>();" for ch in token):
                self.err.write("sh: pipes and redirection are not available in the %s shell\n" % SIM_NAME)
                return 2
            else:
                if token.startswith("$") and len(token) > 1:
                    token = dict(self.env, PWD=self.cwd).get(token[1:].strip("{}"), "")
                words.append(token)
        return code

    def interact(self):
        """The read-eval loop behind `exec -it ... sh`. Ends on `exit` or end of input."""
        code = 0
        while True:
            self.out.write("%s # " % self.cwd)
            self.out.flush()
            try:
                line = sys.stdin.readline()
            except KeyboardInterrupt:
                self.out.write("\n")
                continue
            if not line:
                # End of input (Ctrl-D): leave like a real shell does.
                self.out.write("\n")
                return code
            try:
                code = self.run_line(line.strip())
            except ShellExit as leaving:
                return leaving.code
            self.out.flush()
            self.err.flush()
