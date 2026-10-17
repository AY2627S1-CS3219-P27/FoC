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

The consuming service must provide compatible versions of the package's peer
dependencies: `@nestjs/common`, `@nestjs/config`, `typeorm`, and `joi`. Keeping
these as peers makes Nest's `ConfigService` and TypeORM's `DataSource` resolve
to the service's runtime instances, and lets the exported Joi schemas compose
with the service's Joi schemas.

For a local `file:` dependency, build the package and install it as a packed
copy into the service's `node_modules` so the service consumes the generated
`dist` files rather than relying on host-specific symlinks.

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

During installation, npm validates that the service provides versions matching
the peer ranges. Update the package and its consumers together when one of
these shared runtime dependencies changes major version.

Then, in the consuming app:

1. Register `OutboxEvent` in the service's TypeORM entities and add a migration
   that creates the expected `outbox_events` table.
2. Fold the outbox keys into the service's environment schema:
   `schema.concat(outboxEnvironmentSchema)` and append
   `.custom(validateOutboxTiming)`.
3. Import the module with a database module that exports the default TypeORM
   `DataSource`, plus any modules needed by the options factory:

```ts
OutboxModule.forRootAsync({
  imports: [DatabaseModule, SecretModule],
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
