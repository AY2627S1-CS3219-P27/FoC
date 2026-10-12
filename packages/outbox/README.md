# @foc/outbox

Shared **transactional outbox** for Friend on Campus services. A service that
mutates PostgreSQL state and must reliably publish domain events to RabbitMQ
writes committed envelopes to an `outbox_events` table in the same database
transaction; this package's relay polls that table and publishes each envelope
through a dedicated publisher-confirm channel.

## What it provides

| Export | Purpose |
| --- | --- |
| `OutboxModule` | Dynamic `forRootAsync` module that wires the relay, store, publisher, and Nest lifecycle. |
| `OutboxStore` | Claim / complete / fail SQL over `outbox_events` (`FOR UPDATE SKIP LOCKED`, expiring leases). |
| `OutboxRelay` | Polls claimed batches, publishes concurrently, retries with capped exponential backoff, warns on stale rows. |
| `OutboxRelayLifecycle` | Starts/stops the relay on Nest `OnApplicationBootstrap`/`OnApplicationShutdown`. |
| `RabbitMqOutboxPublisher` | Dedicated recovering confirm channel; confirms + socket drain before marking published. |
| `OutboxEvent` | TypeORM entity for the `outbox_events` table. |
| `AMQP_CONNECT` / `amqpConnectionProvider` | Injection boundary for `amqplib.connect`, replaceable in tests. |
| `outboxEnvironmentSchema` / `validateOutboxTiming` | Joi fragment + cross-field timing check for the `OUTBOX_*` knobs. |

## Adding @foc/outbox to a service

This package depends on `@nestjs/*` and `typeorm`, so it must resolve the
**same copies** the service already has (the same dual-copy rule as
`@foc/auth`). Install it as a packed copy into the service's own
`node_modules`, never rely on the `file:` symlink at runtime.

```json
{
  "dependencies": {
    "@foc/outbox": "file:../packages/outbox"
  },
  "scripts": {
    "outbox:deps": "npm install --no-audit --no-fund --prefix ../packages/outbox",
    "outbox:build": "npm run build --prefix ../packages/outbox",
    "outbox:link": "npm install --install-links --no-audit --no-fund ../packages/outbox",
    "prebuild": "npm run outbox:build && npm run outbox:link"
  }
}
```

> Keep the `@nestjs/*` and `typeorm` ranges in `@foc/outbox` in lockstep with
> the services' ranges. A version bump that no longer intersects forces npm to
> install a second Nest copy and reintroduces the dual-copy bug.

Then, in the consuming app:

1. Register `OutboxEvent` in the service's TypeORM entities so the
   `outbox_events` table is created (via the service's migrations or dev
   `synchronize`).
2. Fold the outbox keys into the service's environment schema:
   `schema.concat(outboxEnvironmentSchema)` and append
   `.custom(validateOutboxTiming)`.
3. Import the module with the broker destination and identity:

```ts
OutboxModule.forRootAsync({
  imports: [SecretModule],
  inject: [SecretService, ConfigService],
  useFactory: (secrets, config) => ({
    exchange: 'foc.events',
    appId: 'user-service',
    rabbitMqUrl: buildRabbitMqUrl(config, secrets),
  }),
})
```

The service owns the `outbox_events` table and the domain writes that enqueue
envelopes; this package only owns the relay/publish mechanics.

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs
npm run build # compile dist/ (consumers read dist/)
npm run lint  # oxlint
```
