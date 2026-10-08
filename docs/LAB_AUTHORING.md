# Writing a unit

A unit is a folder under `server/data/units/`. Adding or changing one needs no code changes: the gateway loads every folder at startup.

```
server/data/units/my-unit/
  unit.json        required   title, level, objectives
  learn.json                  theory sections with optional quizzes
  practice.json               the lab: steps and their checks
  prepare.json                flashcards and interview questions
  casestudy.json              optional long-form case study
```

The folder name is the unit's ID. Use lowercase letters, digits and hyphens.

After editing, run:

```bash
cd server
npm run labs:validate            # structure: must report 0 errors
npm run labs:audit               # behaviour: runs every check in an empty Docker sandbox
cd ../ai-hub
python scripts/build_corpus.py   # refresh the mentor's knowledge base
```

CI runs the validator and fails if the knowledge base is stale.

## unit.json

```json
{
  "id": "my-unit",
  "title": "My Unit",
  "description": "One or two sentences shown on the dashboard card.",
  "difficulty": "beginner",
  "duration": "45 min",
  "category": "Linux",
  "objectives": ["What the learner will be able to do"]
}
```

`id` must equal the folder name. `difficulty` is `beginner`, `intermediate` or `advanced`.

## practice.json

```json
{
  "steps": [
    {
      "step": 1,
      "title": "Create a Project Structure",
      "description": "One paragraph on what this step is about and why.",
      "tasks": [
        "Create a directory called `webapp` in your home directory",
        "Inside `webapp`, create subdirectories: `src` and `public`"
      ],
      "verification": {
        "command": "test -d /home/student/webapp/src && test -d /home/student/webapp/public && echo PASS || echo FAIL",
        "expectedOutput": "PASS",
        "check": "exact"
      }
    }
  ]
}
```

Steps are numbered 1, 2, 3 in order.

**Tasks** are shown to the student. Put commands, file names and tool names in backticks: they are rendered as code, the mentor uses them to work out which tools the step expects, and the abuse scanner is tested against every one of them.

**Verification** runs inside the student's sandbox when they press Verify. It is never sent to the browser.

| `check` | Passes when |
|---|---|
| `exact` | trimmed stdout equals `expectedOutput` |
| `contains` | stdout contains `expectedOutput` |
| `exitCode` | the command exits 0 |

### Writing a good check

- **It must fail on an empty sandbox.** `npm run labs:audit` lists checks that pass before any work is done; those verify nothing.
- **Check the end state, not the keystrokes.** Test that the file exists and has the right content or permissions, so any correct approach passes.
- **Use absolute paths under `/home/student`.** In PTY mode they are mapped to the session's own folder.
- **Use `test -d`, `test -f`, `test -x` and `grep -q ... <file>` for paths.** The mentor reads these to tell a student exactly which files are missing. It never reveals the patterns you grep for.
- **Finish within 10 seconds.** Longer checks are cut off and count as failed.
- **Only use tools that are in the sandbox image** (`sandbox-image/Dockerfile`). The audit lists steps that need something missing. Sandboxes have no network by default.

### Ports: use the variables, never a fixed number

When a task starts something that listens on a port, write the port as one of the three variables every sandbox has:

| Variable | In a container | Use it for |
| :--- | :--- | :--- |
| `$WEB_PORT` | 8080 | the first published web server |
| `$APP_PORT` | 9090 | a second one |
| `$SITE_PORT` | 8000 | a server the student starts by hand |

In Docker mode every sandbox has its own loopback, so everyone gets those numbers. In PTY mode all shells share one machine, so the gateway gives each shell its own block of ports instead. A task that says `-p 8080:80` works for the first student and fails for the second; `-p $WEB_PORT:80` works for both. The variables are also set when a check runs, so a check may use them, guarded with `test -n "$SITE_PORT"` so it cannot pass if the variable is ever missing.

### The simulators: docker, kubectl and aws

A sandbox has no network, no container runtime and no cluster, so three tools are simulated. They are Python scripts in `sandbox-image/bin/` (copied to `/usr/local/bin` in the image, and put first on the PATH in PTY mode). Each keeps its state per student in `~/.opsacademy/<tool>.json` and prints what the real tool would print, including its error messages and exit codes.

- **They say what they are.** `docker info`, `docker version`, `kubectl cluster-info` and `aws --version` all mention "OpsAcademy simulator".
- **Only part of each tool exists.** A subcommand that is not simulated prints `docker: 'swarm' is not available in the OpsAcademy simulator. Supported: ...` and exits 1. Run `docker help`, `kubectl help` or `aws help` to see the list before writing a task around it.
- **One thing is real.** `docker run -d -p HOST:80` on an nginx image (or an image built `FROM nginx`) starts a small web server on `127.0.0.1:HOST`, so `curl localhost:HOST` works. It serves the nginx welcome page, or the files the Dockerfile copied into `/usr/share/nginx/html/`. In PTY mode every session shares the host's ports, so a check should ask `docker port NAME 80` for the port instead of assuming it.
- **`exec` opens a small read-only shell** with `ls`, `cat`, `cd`, `pwd`, `hostname`, `whoami`, `echo`, `env`, `ps` and `exit`. Anything else answers `sh: X: not found`.
- **New pods show `ContainerCreating` for about two seconds**, then `Running`. A check should not require `Running` straight after `kubectl run`.

Some tasks leave nothing behind to inspect ("run `docker info`", "read the logs"). For those, every simulator records each subcommand it handled successfully, and a check can ask whether one was run:

```
docker __ran info                         # exit 0 if `docker info` has been run, else 1; prints nothing
kubectl __ran get-nodes && kubectl __ran exec
aws __ran sts.get-caller-identity
```

| Tool | Key | Examples |
|---|---|---|
| `docker` | the subcommand; removing a container also records `rm:<name>` | `info`, `exec`, `logs`, `stats`, `rm:my-webserver` |
| `kubectl` | the verb, or `verb-resource`; deleting also records `delete-<kind>:<name>` | `logs`, `exec`, `get-nodes`, `describe-pod`, `top-pods`, `delete-deployment:web-app` |
| `aws` | `service.operation` | `s3.ls`, `sts.get-caller-identity`, `iam.list-attached-user-policies` |

`__ran` is for checks only. Never mention it, or the verification command, in a task, a hint or a description.

### A check that fails on an empty sandbox

- **Look for something the student made.** A file with the right content, a container, a bucket with an object in it. `docker --version` or `pwd` succeed for everyone and verify nothing.
- **When a task only shows output, have the student save it.** `ls / > ~/root-dirs.txt` gives the check a file to read. Otherwise use `__ran`.
- **A clean-up step must prove the thing existed.** "No container called `myapp`" is already true on an empty sandbox. Require the removal as well: `docker __ran rm:myapp && ! docker ps -a | grep -q myapp`.
- **Stay on loopback.** No `ping`, `dig`, `nslookup` or outside hosts. To practise HTTP, have the student start `python3 -m http.server` on `127.0.0.1` and `curl` that.
- **Write the home directory as `/home/student`** in a check, never `~` or `$HOME`.
- **Prove it both ways.** `sandbox-image/tests/test_lab_checks.py` runs each check before and after the commands of its tasks. Add the commands of a new step there, then run:

```bash
python3 -m pytest sandbox-image/tests -q
```

## learn.json

```json
{
  "sections": [
    {
      "id": "permissions",
      "title": "File Permissions",
      "content": [
        { "type": "text", "value": "Every file has an owner, a group and..." },
        { "type": "code", "language": "bash", "value": "chmod 755 deploy.sh" }
      ],
      "quiz": {
        "question": "What does chmod 755 grant the group?",
        "options": ["Nothing", "Read only", "Read and execute", "Everything"],
        "correctIndex": 2,
        "explanation": "5 is read (4) plus execute (1)."
      }
    }
  ]
}
```

Section IDs must be unique within the unit. `content` may also be a single Markdown-style string. A correct quiz answer is checked on the server and earns XP once.

## prepare.json

```json
{
  "flashcards": [
    { "id": "fc-1", "front": "What does the pipe symbol do?", "back": "Sends stdout of the left command to stdin of the right." }
  ],
  "interviewQuestions": [
    {
      "id": "iq-1",
      "question": "A server's disk is 95% full. Walk me through it.",
      "difficulty": "intermediate",
      "modelAnswer": "1. `df -h` to find the full partition...",
      "keyPoints": ["df -h for partition overview", "du -sh for directory sizes", "Log rotation as prevention"]
    }
  ]
}
```

IDs must be unique within the unit: flashcard review schedules and interview scores are stored against them, so do not renumber existing ones.

`keyPoints` are the rubric for the mock interview. An answer covers a point when it contains the command quoted in it, names its technical terms, or shares at least half of its meaningful words. Write points as short, concrete phrases that a good answer would naturally contain. Without `keyPoints`, the steps of `modelAnswer` are used instead, which is rougher.

## Older layouts

Five units were written before this format settled. The loader still accepts `modules` for `sections`, `questions` for `interviewQuestions`, and `question`/`answer` flashcards, and `labs:validate --verbose` lists them as warnings. Use the names above for new content.
