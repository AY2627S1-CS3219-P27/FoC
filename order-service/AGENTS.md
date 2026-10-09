# order-service

Module M.3: errand lifecycle, state model, expiry. Emits `ErrandCompleted` / `ErrandCancelled`, which credit-service consumes.

Read `CONTEXT.md` (terms), `ARCHITECTURE.md` (state model, write path) and `order-messaging-feature-docs.md` (messaging build order, open decisions) first. ADRs are in `../docs/adr/order-service/`.

## Stack

NestJS 12 (ESM, `.js` import suffixes), PostgreSQL 18, Drizzle ORM (`drizzle-kit` migrations in `drizzle/`), Joi env validation, Vitest, oxlint. Hand-rolled event sourcing (ADR 0001); RabbitMQ for cross-service notices (ADR 0002).

## Commands

Run from `order-service/`:

- `npm run start:dev`: watch mode (in Docker, via `docker compose up --watch` from the repo root).
- `npm run build` / `npm run lint`
- `npm test`: unit specs (`src/**/*.spec.ts`). `npm run test:e2e`: `**/*.e2e-spec.ts`.
- `npm run test:messaging`: real-broker publisher test; needs `RABBITMQ_URL` (an `order-service` login on a running broker).
- `npm run db:generate`: generate a migration after editing `src/db/schema.ts`. `npm run db:migrate`: apply it.

## Rules

- Only the Lifecycle module (`src/lifecycle/`) writes errand state. Every write, from a request, a notice reply or a sweep, goes through the one transition function (conditional `UPDATE … WHERE status = expected` + `INSERT errand_events` in one transaction).
- Every `transition()` caller passes the actor explicitly: `user(id)` from an authenticated request, `SYSTEM` from message consumers and sweeps. Never default to `SYSTEM`. Callers must handle the refusals `FORBIDDEN`, `COURIER_BUSY` (not stored under an idempotency key, so retry-able), `EXPIRED` (accept only; the errand stays `Open` for the sweep to cancel) and `IDEMPOTENCY_KEY_REUSED`.
- Cancellation reasons are tied to the actor: `REQUESTER_CANCELLED` is user-only, every other reason system-only (`USER_REASONS` in `edges.ts`). The set is also a DB CHECK.
- Allowed transitions live in `src/lifecycle/status.ts` (`ALLOWED`); change them there and in `ARCHITECTURE.md` §2 together.
- Sub-states (`Pending-Supplier`, `Reserving-Credit`) are shown as `Pending` at the API. The other in-flight credit statuses (`Transferring-Credit`, `Adjusting-Credit`, ADR 0006) are likewise internal and shown as the status around them. A `from`/`to` pair with several exits (`Adjusting-Credit` → `Open`) is picked by `TransitionInput.type`.
- New env vars: add to `src/config/environment.schema.ts`, `compose.yml` and `../env/order-service.env.example` (shared ones in `../env/shared.env.example`).
- DB and RabbitMQ passwords are Docker secrets (`secrets/order_db_password.secret`, `secrets/rabbitmq_password.secret`, copy from the `.example`); never commit them. The RabbitMQ one must match the `order-service` hash in `../rabbitmq/definitions.json`.
