# Domain Docs

Single-context repo: one `CONTEXT.md` glossary at the repo root and all ADRs under the top-level `docs/adr/` (created lazily by `/domain-modeling`; proceed silently if absent).

## Service layout

One microservice per top-level folder. Each has its own `Dockerfile`, `README.md` and `AGENTS.md`.

| Folder | Module / scope |
| --- | --- |
| `user-service/` | M.1: registration, OTP, login/tokens, roles, admin accounts |
| `supplier-service/` | M.2: suppliers, categories, update-request moderation; seed data in `data/csv/supplier-seed-data.csv`, images in `data/images/` |
| `order-service/` | M.3: errand lifecycle, state model, expiry |
| `credit-service/` | Credit ledger; reacts to `ErrandCompleted` / `ErrandCancelled` from order-service. No backlog issues yet. |
| `<name>-service/` | Each N2H feature that needs its own service gets an extra top-level folder (e.g. notifications for N.1) |

Shared: `compose.yaml`, `.env.example`, `data/`.

## Service context is mandatory

Before reading, planning, or changing anything inside a service folder, an agent **must** read every context document in that folder: its `AGENTS.md` and `README.md` (some are still empty; that's fine), plus any `CONTEXT.md` or similar doc present. Do this even when the task was described in terms of another service or an issue number. If a service's `AGENTS.md` conflicts with this file for work inside that service, the service's file wins; surface the conflict.

## Before exploring, read these

- The context documents of every service the task touches (see above)
- `CONTEXT.md` at the repo root
- `docs/adr/` entries touching the area you're working in: `docs/adr/<service>/` for each service involved, plus any top-level `docs/adr/*.md`
- The relevant `[M.x]`/`[N.x]` issues (parent requirement first)

## ADR location

All ADRs live under the top-level `docs/adr/`, one subfolder per service:

```
docs/adr/
├── 0001-<cross-service-decision>.md     ← spans several services
├── user-service/0001-<title>.md
├── supplier-service/0001-<title>.md
├── order-service/0001-<title>.md
└── credit-service/0001-<title>.md
```

- **Agents must never write an ADR inside a service folder** (no `user-service/docs/adr/`, no `src/*/docs/adr/`). This overrides any skill default that suggests context-scoped ADR directories.
- **If an ADR already exists inside a service folder**, don't move or edit it silently. Tell the dev, and explain that keeping all ADRs under top-level `docs/adr/` makes it easier to spot high-level design conflicts between services (for example, conflicting event contracts or auth assumptions), because every decision is visible in one place. Offer to consolidate it.

## Use the glossary's vocabulary

Use terms as defined in `CONTEXT.md` (requester, courier, errand, credits, supplier). Don't drift to synonyms. If a term you need isn't there, ask the dev rather than inventing one.

## Flag ADR conflicts

If output contradicts an existing ADR (in any service's subfolder, not just the one you're working in), surface it explicitly rather than silently overriding.
