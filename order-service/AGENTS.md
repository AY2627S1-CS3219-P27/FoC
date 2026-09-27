# order-service

Module M.3: errand lifecycle, state model, expiry. Emits `ErrandCompleted` / `ErrandCancelled`, which credit-service consumes.

Read `CONTEXT.md` (terms), `ARCHITECTURE.md` (state model, write path) and `tracking.md` (build order, open backlog conflicts) first. ADRs are in `../docs/adr/order-service/`.

## Stack

NestJS 12 (ESM, `.js` import suffixes), PostgreSQL 18, Drizzle ORM (`drizzle-kit` migrations in `drizzle/`), Joi env validation, Vitest, oxlint. Hand-rolled event sourcing (ADR 0001); RabbitMQ for cross-service notices (ADR 0002).

## Commands

Run from `order-service/`:

- `npm run start:dev`: watch mode (in Docker, via `docker compose up --watch` from the repo root).
- `npm run build` / `npm run lint`
- `npm test`: unit specs (`src/**/*.spec.ts`). `npm run test:e2e`: `**/*.e2e-spec.ts`.
- `npm run db:generate`: generate a migration after editing `src/db/schema.ts`. `npm run db:migrate`: apply it.

## Rules

- Only the Lifecycle module (`src/lifecycle/`) writes errand state. Every write, from a request, a notice reply or a sweep, goes through the one transition function (conditional `UPDATE … WHERE status = expected` + `INSERT errand_events` in one transaction).
- Allowed transitions live in `src/lifecycle/status.ts` (`ALLOWED`); change them there and in `ARCHITECTURE.md` §2 together.
- Sub-states (`Pending-Supplier`, `Pending-Credit`) are shown as `Pending` at the API.
- New env vars: add to `src/config/environment.schema.ts`, `compose.yml` and the root `.env.example`.
- DB password is a Docker secret (`secrets/order_db_password.secret`, copy from the `.example`); never commit it.
