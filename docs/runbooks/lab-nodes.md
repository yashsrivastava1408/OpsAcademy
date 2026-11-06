# Runbook: lab nodes

Follows ADR 0005. A lab node is a server running the **lab node agent**, the only process that controls Docker.
The gateway and the worker talk to agents over a private network and never mount the Docker socket.

## One host (gateway and lab node on the same machine)

```
# .env.production
NODE_TOKEN=<openssl rand -hex 32>      # required, 32+ characters
NODE_ID=node-1
NODE_CAPACITY=45                       # sandboxes this host can run at once

docker compose -f docker-compose.prod.yml -f docker-compose.nodes.yml up -d --build
```
The overlay sets `SANDBOX_MODE=remote` on the gateway and worker, removes the Docker socket from the gateway, and starts
the `lab-node` service (which has it). Migrations `0010` and `0011` must have run (the `migrate` service does this).

Check: `docker compose exec server printenv SANDBOX_MODE` is `remote`; `docker inspect opsacademy-server` shows no
`docker.sock` mount; `GET /api/admin/overview` (as a platform admin) lists the node; start a lab and use the terminal.

Sizing: `NODE_CAPACITY` x (`SANDBOX_MEMORY_MB` + overhead) must fit in the host's memory. A starting point is 256 MB per
sandbox, so a 16 GB host runs about 45 with room for the system.

## More lab servers

On each extra server run only the agent (Docker and the `opsacademy-sandbox` image must be present):

```
docker run -d --name opsacademy-lab-node --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e NODE_ENV=production -e NODE_ID=node-2 -e NODE_TOKEN=<same token> \
  -e NODE_BASE_URL=http://<this server's private address>:7000 -e GATEWAY_URL=http://<gateway private address>:4000 \
  -e NODE_CAPACITY=45 -p <private address>:7000:7000 \
  opsacademy-server node lab-node.js
```
Never publish port 7000 to the internet: it is reachable only from the gateway and worker (security group / firewall rule).
Rotate `NODE_TOKEN` on every node and the gateway together.

## Stronger isolation: gVisor (optional)

gVisor runs each sandbox against a user-space kernel, so a kernel exploit inside a sandbox does not reach the host. On every
lab server:

```
# install runsc (https://gvisor.dev/docs/user_guide/install/), then register it with Docker:
sudo runsc install            # adds the "runsc" runtime to /etc/docker/daemon.json
sudo systemctl restart docker
docker run --rm --runtime=runsc opsacademy-sandbox:latest echo ok   # must print ok
```
Then give the agent `SANDBOX_RUNTIME=runsc`. The agent refuses to start if Docker does not have that runtime, and
`GET /v1/health` reports the runtime in use. Every other restriction (no capabilities, read-only root, limits) stays.
Measure the cost with the load test before choosing it for production: gVisor adds overhead to system calls and file
access, and a few lab commands that need unusual kernel features may behave differently. Roll out one node first.

## Operating

| Task | How |
| --- | --- |
| See nodes and load | `select * from lab_nodes` (last_seen_at, running, capacity, draining) |
| Drain a node for maintenance | `docker kill -s SIGTERM opsacademy-lab-node` (it announces `draining`, takes nothing new, leaves running sandboxes alone), wait for sessions to end, then stop it |
| A node died | Within 30 s it leaves placement. Its sessions answer 503; after 5 min (`NODE_UNREACHABLE_MS`) the worker drops their records |
| Orphaned containers | The worker's `reconcile-lab-nodes` job (every 2 min) destroys sandboxes no session points at, and drops sessions whose sandbox is gone |
| Turn off bearer tokens in terminal URLs | After every browser uses tickets, set `TERMINAL_TOKEN_AUTH=off` on the gateway |

## Rollback

Deploy with `docker-compose.prod.yml` alone (`SANDBOX_MODE=docker`): the gateway runs sandboxes itself again. Sessions
recorded on a node are not visible to a gateway running its own Docker, so drain labs first.
