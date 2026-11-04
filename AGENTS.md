# FoC (Friend on Campus)

Peer-to-peer campus errand platform: four microservices (`user-service`, `supplier-service`, `order-service`, `credit-service`), one top-level folder each, wired by `compose.yaml`. Glossary: `CONTEXT.md`. Every env var a service reads must appear in that service's `env/<service>.env.example` (shared ones in `env/shared.env.example`).

## Conventions

### Issue tracker

GitHub Issues on `AY2627S1-CS3219-P27/FoC` plus Project #1 (Sprint, Priority). Branches: `features/<issue#>-<slug>`, `bug/<issue#>-<slug>`. See `docs/agents/issue-tracker.md`.

### Triage labels

Agent-raised issues get one triage label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); seeded issues are classified by their Sprint and Priority fields. Issues devs raise and title themselves are their own concern. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context; one folder per microservice. Read a service's `AGENTS.md` (and README, if non-empty) before touching it. All ADRs go in top-level `docs/adr/<service>/`, never inside a service folder. See `docs/agents/domain.md`.

### Image versions

Service images are tagged from each app's `package.json` version: `./scripts/build-images.sh` builds all six, and `./scripts/build-images.sh up -d --wait` runs that versioned stack. Plain `docker compose` uses the `dev` tag.

### Networks and host ports

`compose.yaml` splits traffic: the browser reaches only the frontend (`public`, port 3001), which proxies `/api/*` to the services; services, databases, Redis, RabbitMQ and the observability stack share `internal`, which publishes nothing to the host; `ops` carries the RabbitMQ, Papercut, Prometheus, Tempo, Loki and Grafana UIs on 127.0.0.1. For direct access while debugging, add `-f compose.debug.yaml`, which publishes service and database ports on 127.0.0.1.
