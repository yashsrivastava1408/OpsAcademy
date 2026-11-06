# ADR 0005: Lab node agent, session registry and terminal routing

Status: accepted (Phase 3, issue #100). Implemented: the registry, the agent (`server/lab-node/`), the remote engine, heartbeats,
placement, tickets, the terminal router and reconciliation. See `docs/runbooks/lab-nodes.md` to run it.

## Context

Today one gateway process does everything: it answers HTTP, holds every student session in a `Map`, runs the
Docker containers through the Docker socket, and pipes each terminal WebSocket to a container it owns.

- A second gateway instance cannot see another's sessions, so the gateway cannot be scaled or restarted
  without ending every lab.
- The process that faces the internet controls the container runtime. A bug in the gateway is a bug with
  root-equivalent reach to the host.
- The terminal URL carries the user's JWT in the query string, which ends up in access logs.
- One host caps the lab at what a single machine can run (625 concurrent students is the SRM target).

## Decision

### 1. Roles

| Component | Holds | Talks to |
| --- | --- | --- |
| **Gateway** (many, stateless) | HTTP API, terminal router, nothing else in memory that matters | Postgres, lab nodes, AI hub |
| **Lab node agent** (one per lab server) | Docker socket, the containers, a small warm pool | Gateway (answers calls; sends heartbeats) |
| **Postgres** | Session registry, node registry, terminal tickets | |

The gateway has **no Docker socket**. Only agents do.

### 2. Session registry (done)

`public.sandbox_sessions` is the source of truth: `session_id`, `engine_id` (the sandbox's id on its node),
`node_id`, `user_id`, `lab_id`, `created_at`, `last_active_at`, capped `history`, `strikes`. Every gateway
instance reads and writes it through `repos.sessions` (`get`, `listByUser`, `count`, `touch`, `appendCommand`,
`addStrike`, `listExpired`, `delete`).

Rules the manager follows:

- A session exists when its row exists. Creating the row is the last step of a start; if it fails the sandbox is destroyed.
- **Deleting the row is the claim to end a session.** When two instances race (reaper vs. the student), one `delete` returns true and only that caller destroys the sandbox.
- Activity writes are throttled to one per session per 30 s (the idle limit is minutes), so typing does not hit the database. Commands are appended in order, per session, to a list capped at `SANDBOX_HISTORY_LIMIT`.
- Per-user and total limits count registry rows plus starts in flight in this process. Admission checks in one process run one at a time. Across instances a burst can overshoot by at most the number of instances; the node's own capacity limit (below) is the hard stop.
- What stays in a gateway's memory is only what cannot be shared: the sockets waiting for a close, writes in flight, a strike counter that is reconciled with the registry.

### 3. Lab node agent API

An internal HTTP API on a private address, every request authenticated with `Authorization: Bearer <NODE_TOKEN>`
(a long random secret per environment, compared in constant time; mTLS between gateway and agent is the next
hardening step and does not change the API). Agents never receive database credentials.

| Call | Meaning |
| --- | --- |
| `POST /v1/sandboxes` `{ labId }` | Create a sandbox (taken from the node's warm pool when one is waiting). `201 { engineId, nodeId, fromPool }`, or `503 node_full` when the node is at its hard limit. The node chooses the id |
| `DELETE /v1/sandboxes/:engineId` | Destroy it (idempotent) |
| `POST /v1/sandboxes/:engineId/exec` `{ command, timeoutMs? }` | Run a command: `{ exitCode, stdout, stderr }` |
| `POST /v1/sandboxes/:engineId/reset` | Wipe the student's home directory |
| `GET /v1/sandboxes` | Sandboxes running on the node (used by reconciliation) |
| `GET /v1/health` | `{ nodeId, capacity, running, draining, version }` |
| `WS /v1/sandboxes/:engineId/attach` | Raw terminal stream. Text frames both ways; a JSON `{type:"resize",cols,rows}` frame resizes |

The agent reuses `dockerService` unchanged, so all the container hardening stays in one place. The gateway-side
`remoteEngine` implements the same engine interface (`create`, `destroy`, `exec`, `attach`, `reset`, ...) by calling
these endpoints, so `sandboxManager` does not know whether a sandbox is local or remote.

### 4. Node registry, heartbeats and placement

`public.lab_nodes (node_id, base_url, capacity, running, draining, last_seen_at, version)`.

- Each agent sends `POST /api/internal/nodes/heartbeat` to the gateway every 10 s with `{ nodeId, baseUrl, capacity, running, draining }`, authenticated with the same node token. Any gateway instance records it.
- A node is **healthy** if `last_seen_at` is within 30 s and it is not draining. A dead node therefore leaves placement within a minute.
- **Placement** picks the healthy node with the most free seats (`capacity - running - starts in flight`). If none has room, the start answers `503` ("all labs are busy"); queueing is Phase 4.
- The agent enforces its own hard limit (`503 node_full`) so two gateways choosing the same node at the same moment cannot exceed it; the gateway then tries the next node once.
- A drained node takes no new sessions and is removed when empty.

### 5. Terminal tickets (replacing the JWT in the URL)

1. The browser calls `POST /api/sandbox/:id/terminal-ticket` with its normal bearer token.
2. The gateway checks ownership and stores `sha256(ticket)` with `session_id`, `user_id`, `expires_at = now + 30 s` in `terminal_tickets`, and returns the ticket (32 random bytes, base64url).
3. The browser opens `wss://…/api/terminal?ticket=…`. The gateway deletes the row in one statement (`delete … where hash = $1 and expires_at > now() returning …`): **a ticket works once** and a replay finds nothing.
4. Expired tickets are pruned by the maintenance worker. A ticket in a log is useless after 30 s or one use.

### 6. Terminal router

The gateway terminates the browser WebSocket, applies `commandGuard` (so abuse rules and strikes stay in one place),
looks up the session's node in the registry and opens `WS /v1/sandboxes/:engineId/attach` to that node, then pipes both
ways. The browser never learns a node address. If the node connection drops, the browser socket closes with a
reconnect-able code; reconnecting asks for a new ticket and re-attaches to the same container (P3-12).

### 7. Failure handling

| Failure | Behaviour |
| --- | --- |
| Gateway instance dies | Sessions are untouched (registry + node). Browsers reconnect through any other instance. |
| Node agent dies or is unreachable | Heartbeats stop; the node leaves placement within 1 min. Its sessions return `503 node unavailable` to exec; terminals close and retry. After 5 minutes unreachable, the maintenance job deletes those rows. |
| Node comes back | It lists what it runs. **Reconciliation** (maintenance job, advisory lock): containers with no registry row are destroyed; rows whose container is gone are deleted. |
| Postgres unavailable | Gateway cannot start or end sessions; running terminals keep streaming (node connection is direct). Health reports not ready. |
| Row created, container start fails | The start fails and nothing is recorded. |
| Container started, row write fails | The container is destroyed immediately. |

### 8. Reaping

The idle/max-age reaper runs in the **maintenance worker** under an advisory lock (one at a time cluster-wide);
gateways also sweep their own node in single-node deployments. Each reap uses the delete-as-claim rule above.

### 9. Start → attach → reap

```
Browser            Gateway (any)                Postgres               Node agent
  | POST /sandbox/start  |                          |                       |
  |--------------------->| count + limits --------->|                       |
  |                      | pick node  <-------------| lab_nodes             |
  |                      | POST /v1/sandboxes ------------------------------>| create container
  |                      | insert sandbox_sessions->|                       |
  |<---------------------| 201 { sessionId }        |                       |
  | POST …/terminal-ticket                          |                       |
  |--------------------->| insert ticket(hash, 30 s)|                       |
  |<---------------------| { ticket }               |                       |
  | WS /api/terminal?ticket                         |                       |
  |--------------------->| delete ticket returning->|                       |
  |                      | WS …/attach (node token) ------------------------>| exec bash (tty)
  |<======== keystrokes / output piped, commandGuard on input ===============>|
  |                      |                          |                       |
Maintenance worker       | listExpired ------------>|                       |
                         | delete row (claim) ----->|                       |
                         | DELETE /v1/sandboxes/:id ------------------------>| remove container
```

## Consequences

- Gateways become disposable: deploy, scale and restart them without ending labs (proved by P3-11's two-instance test).
- The internet-facing process loses the Docker socket (P3-04); the threat model is updated when that lands.
- Every request that touches a session now costs one primary-key read. Latency to Postgres matters: keep the gateway and database in the same region (see the Mumbai move in the production plan).
- Node-to-gateway traffic crosses a private network and needs the node token handled as a secret.

## Out of scope

mTLS, per-college node pools, gVisor (P3-10), queueing and slots (Phase 4), live migration of a running container between nodes.
