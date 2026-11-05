# ADR 0002: Repository layout

Status: accepted. Stage 1 applies from Phase 1; stage 2 is tracked in a dedicated issue.

## Target layout (monorepo)

```
apps/
  web/            React SPA (today: client/)
  gateway/        Node API gateway + lab orchestration (today: server/)
  ai-hub/         Python AI mentor service (today: ai-hub/)
packages/         shared code once two apps need it (API types, lab definitions)
db/ (supabase/)   migrations/, tests/ (RLS + schema), seed/
infra/
  docker/         compose files, Caddyfile, sandbox image
  k8s/            manifests
  monitoring/     Prometheus, Grafana, Alertmanager
  scripts/        deploy and ops scripts
docs/
  adr/            architecture decision records (numbered, never rewritten)
  runbooks/       deploy, restore drill, incident response, load test
  api/            OpenAPI spec (Q-06)
.github/          workflows, templates, CODEOWNERS
```

## Layering inside the gateway (stage 1, applied now)

```
routes/         HTTP only: parse, validate, call a service, shape the response
services/       business rules; no SQL, no HTTP
repositories/   the only code that touches the database (memory + postgres, one contract)
middleware/     auth, rate limit, errors, request ids
jobs/           background work (worker process): pruning, leaderboard refresh
lib/            small stateless helpers (logger, metrics, units, migrator)
config/         environment parsing and validation
tests/          unit + contract tests; DB tests need TEST_DATABASE_URL
scripts/        one-off CLIs (migrate, data migration, load test)
```

Rules: routes never import repositories; services never import `express`; repositories
never import services. Dependencies point downward only.

## Stage 2: root move

Move `client/` -> `apps/web/`, `server/` -> `apps/gateway/`, `ai-hub/` -> `apps/ai-hub/`,
infra files under `infra/`, in one PR that also updates CI paths, Dockerfiles, compose,
k8s, Vercel root and docs. Done in one step, after Phase 1, so open branches do not conflict.
