# FoC (Friend on Campus)

Peer-to-peer campus errand platform: four microservices (`user-service`, `supplier-service`, `order-service`, `credit-service`), one top-level folder each, wired by `compose.yaml`. Glossary: `CONTEXT.md`. Every env var a service reads must appear in that service's own `.env.example` (no root one; `compose.yaml` loads each service's `.env` via `include.env_file`).

## Conventions

### Issue tracker

GitHub Issues on `AY2627S1-CS3219-P27/FoC` plus Project #1 (Sprint, Priority). Branches: `features/<issue#>-<slug>`, `bug/<issue#>-<slug>`. See `docs/agents/issue-tracker.md`.

### Triage labels

Agent-raised issues get one triage label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); seeded issues are classified by their Sprint and Priority fields. Issues devs raise and title themselves are their own concern. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context; one folder per microservice. Read a service's `AGENTS.md` (and README, if non-empty) before touching it. All ADRs go in top-level `docs/adr/<service>/`, never inside a service folder. See `docs/agents/domain.md`.
