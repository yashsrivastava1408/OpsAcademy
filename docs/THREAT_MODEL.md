# Threat model

OpsAcademy hands a Linux shell to anyone who opens the site. This document says what an attacker can try, what stops them, how each control is checked, and where the gaps are.

## What we are protecting

| Asset | Why it matters |
|---|---|
| The host and its Docker daemon | Control of the host is control of every student's sandbox and the data store. |
| Other students' sandboxes | A student must not read, type into or destroy someone else's session. |
| Accounts, progress and certificates | Certificates are only worth something if they cannot be forged. |
| Secrets (`JWT_SECRET`, `CERT_SECRET`, `AI_HUB_TOKEN`, LLM key) | They sign tokens and certificates and gate the AI hub. |
| Capacity | A free shell is an invitation to mine coins or exhaust the machine. |

## Who attacks

1. **A curious or hostile student** inside a sandbox, with a shell and time.
2. **An anonymous internet client** calling the API and WebSocket directly, never loading the UI.
3. **Another logged-in user** who has learned or guessed a session ID or certificate ID.

Out of scope: a compromised host, a malicious operator, and kernel 0-days (see "Known gaps").

## Sandbox isolation (Docker mode)

`SANDBOX_MODE=docker` is the only mode meant for untrusted users. Every sandbox is a container created by `server/services/dockerService.js` with these settings. Each row is exercised by `server/scripts/docker-check.js`, which tries to break the restriction from inside a real container and runs in CI.

| Attack | Control | Checked by |
|---|---|---|
| Escalate to root | Runs as uid 1000, all capabilities dropped, `no-new-privileges`, no sudo or setuid binaries in the image | uid is 1000; `CapEff/CapPrm/CapBnd` are all zero; `NoNewPrivs` is 1; no setuid files found |
| Tamper with the system | Read-only root filesystem | writing to `/etc`, `/usr/bin` and `/` fails |
| Fill the host disk | The only writable space is tmpfs: 64 MB home, 64 MB `/tmp` | a 200 MB write stops at 64 MB |
| Fork bomb | `PidsLimit` 128 | of 400 forks, about 125 start and the rest are refused |
| Exhaust memory | 256 MB limit with swap disabled | a 512 MB allocation is OOM-killed; the sandbox survives |
| Hog the CPU | 0.5 CPU quota | set in the container config (not load-tested) |
| Mine coins, attack other hosts, exfiltrate | No network interface at all (`NetworkMode: none`) | only loopback has an address; an outbound request fails |
| Reach the Docker daemon | The socket is never mounted into a sandbox | `/var/run/docker.sock` does not exist inside |
| Linger forever | Reaper destroys sandboxes after 15 idle minutes or 30 minutes total; containers are labelled and orphans are removed at startup | unit tests on the sweep; shutdown leaves zero containers |
| Hang a verification | Checks run with a 10 s timeout | a `sleep 30` check is cut off |

Docker's default seccomp profile applies. `SANDBOX_SECCOMP_PROFILE` can point at a stricter one.

Labs that need the network (`curl` to the internet, `dig`) do not work with `none`. `SANDBOX_NETWORK=internal` gives each sandbox a private bridge with no route out; `bridge` allows the internet and removes the protection in the "mine coins" row.

## The terminal tripwire is not a boundary

`server/lib/commandGuard.js` rebuilds each command line from keystrokes and blocks fork bombs, `rm -rf /`, miners, reverse shells and container-escape attempts before Enter reaches the shell. Three strikes destroy the sandbox. It also sees through base64 and `\x` hex encoding.

It is trivially bypassed by anyone who means to: put the command in a script, an alias or an editor. It exists to stop casual abuse early, tell the student why, and leave an audit trail (`opsacademy_commands_blocked_total`). The container limits above are what actually contain a student.

The AI hub's Isolation Forest only flags commands for review. On held-out course commands it flags 1.8%, and it catches 3 of 10 hostile commands that no rule covers, so it is not used to block anything.

## API and WebSocket

| Attack | Control | Checked by |
|---|---|---|
| Attach to someone else's terminal | The WebSocket upgrade is refused before it completes unless the token is valid **and** owns the session (401 / 403 / 404) | `tests/terminal.test.js`, `scripts/e2e.js` |
| Read, reset or stop someone else's sandbox | Every sandbox route checks ownership and answers 404 for both "not yours" and "does not exist" | `tests/api.test.js` |
| Enumerate sessions | Public stats are aggregates only. The full list is under `/api/admin`, which does not exist unless `ADMIN_TOKEN` is set | `tests/api.test.js` |
| Forge a token | HS256 only; `alg: none` and foreign signatures are rejected; production refuses to start with the default secret | `tests/api.test.js`, `tests/services.test.js` |
| Brute-force logins | 20 sign-in attempts per minute per client; bcrypt; identical response for unknown email and wrong password | `tests/api.test.js` |
| Start sandboxes without limit | 2 per user, 25 in total, 10 starts per minute; guest identities are rate limited per IP | `tests/sandboxManager.test.js` |
| Flood a terminal | 64 KB frame limit; 2000 messages per 10 s | `tests/terminal.test.js` |
| Path traversal through unit IDs or file preview | Unit IDs must match a slug pattern; preview paths must be plain relative paths | `tests/lib.test.js`, `tests/api.test.js` |
| Read the lab answers from the network tab | Verification commands never leave the server | `tests/api.test.js` |
| Forge a certificate | Issued only to a registered account for a unit completed through sandbox checks; signed with HMAC-SHA256 over every field; the public verify endpoint recomputes the signature | `tests/api.test.js`, `tests/services.test.js` |
| Call the AI hub directly | With `AI_HUB_TOKEN` set, the hub rejects every request without it; in Compose and Kubernetes it is not published at all | `ai-hub/tests/test_app.py` |
| Get the mentor to reveal the check | The verification command is never put in the LLM prompt, and every hint passes a leak guard | `ai-hub/tests/test_mentor_pipeline.py`, `evals/run_eval.py` |

Auth is a bearer token in `localStorage`, never a cookie, so there is no CSRF surface. The cost is that an XSS bug would expose the token; the client's Content-Security-Policy limits scripts to its own origin and connections to the configured API.

## Known gaps

These are real and unfixed. Read them before putting this in front of untrusted users.

1. **PTY mode has no isolation.** `SANDBOX_MODE=pty` runs a shell as the gateway's own OS user. A student can read anything that user can, including the gateway's environment via `/proc`, and so the JWT secret. It is for local development and demos. The Render blueprint and the Kubernetes manifests use it because neither can start sibling containers; treat those deployments as demos.
2. **The gateway holds the Docker socket.** In Docker mode the gateway can do anything on the host. A remote-code-execution bug in the gateway is a host compromise. Mitigations not done here: a socket proxy that only allows container create/exec/remove, or rootless Docker.
3. **Shared kernel.** Containers are not VMs. A kernel exploit escapes them. gVisor or Firecracker would close this.
4. **The token is in the WebSocket URL**, because browsers cannot set headers on a WebSocket. It can land in proxy access logs. A short-lived, single-use ticket would be better.
5. **Single process, single file.** Sessions, rate-limit counters and the data store live in one gateway process. There is no failover, and a second replica would not share state.
6. **Verification trusts the sandbox.** A check runs inside the student's own sandbox and mostly looks at end state (does this file exist, does it contain this text). A student can reach that state without understanding the step, and one who studies the check's behaviour could fake it. A certificate says the checks passed, not that the holder could repeat the work in an interview.
7. **Guest accounts are free.** Rate limits slow abuse; they do not stop a patient attacker with many IP addresses.
8. **CPU limits and the reaper have unit tests but no load test.** Behaviour with 25 busy sandboxes on a small machine is unmeasured.
