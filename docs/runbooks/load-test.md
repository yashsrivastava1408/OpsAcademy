# Runbook: load test at SRM scale (625 concurrent sessions)

Goal: show that the platform carries a full college lab (625 students) at once, with typing that still feels instant.
This needs real servers; the numbers from a laptop are not evidence. Run it only against a **staging** stack, never
the production database.

## What is simulated

`server/scripts/loadtest.js` plays what the lab page does for each student: guest sign-in, start a sandbox, open the
terminal with a ticket, type commands at human speed, poll history and the inspector, verify a step, ask the mentor for a
hint. It reports keystroke-to-echo, command round trip, sandbox start, first-output time, every failed request, and the
gateway's CPU and memory.

## Setup (staging)

1. Gateways: two or more, behind the proxy, `SANDBOX_MODE=remote`, same `DATABASE_URL` (a staging database).
2. Lab nodes: enough that total `NODE_CAPACITY` is at least 700 (for example 10 nodes at 70, or the largest instance type you
   will really use). Each sandbox is limited to `SANDBOX_MEMORY_MB` (256 by default): 70 sandboxes need about 18 GB plus
   headroom. Optionally `SANDBOX_RUNTIME=runsc` (gVisor) to measure the cost of the stronger isolation.
3. Limits for the test only: on the gateways set `RATE_LIMIT_GUEST=2000`, `RATE_LIMIT_API=100000`,
   `RATE_LIMIT_SANDBOX_START=2000` (all 625 "students" share the load generator's address), and `SANDBOX_MAX_PER_USER=2`.
4. AI hub: with an API key the hint step costs money; run without one (the offline fallback) or pass a low `--students`
   for the mentor part.
5. Run the generator from a machine on the same network as the staging stack (not your laptop's Wi-Fi), and raise its file
   limit: `ulimit -n 10000`.

## Run

```
cd server
node scripts/loadtest.js https://staging.example.com \
  --students 625 --seconds 300 --ramp 120 \
  --max-start-p95 5000 --max-prompt-p95 3000 --max-echo-p95 150 --max-command-p95 1500 \
  --max-error-rate 0.01 --min-peak 620
```
Exit code 0 means every threshold held. A failure prints which one broke. `--ramp 120` starts the students over two
minutes, like a class logging in; use `--ramp 10` to test a stampede.

## What to record

Copy the printed table and the JSON line into the pull request or `docs/` with: instance types, number of gateways and
nodes, `SANDBOX_MODE`, runtime (runc or runsc), database region. Also watch, during the run:

- `select node_id, running, capacity from lab_nodes` (is load spread?),
- Grafana: event-loop lag, database connections, container start rate,
- `docker stats` on one node (memory per sandbox).

## If it fails

| Symptom | Likely cause |
| --- | --- |
| Many 503 "all sandboxes are in use" | total node capacity is below the students, or heartbeats stopped (a node left placement) |
| 429 on guest or start | the test rate limits above were not raised |
| Slow start p95 | cold starts: raise `SANDBOX_POOL_SIZE` on nodes, or the nodes are CPU bound |
| Slow echo | database or node network latency; check the gateway-to-node path and the event-loop lag |
| Sandboxes left running afterwards | the run was interrupted; the worker reaps them within `SANDBOX_IDLE_MINUTES`, and `reconcile-lab-nodes` removes the rest |
