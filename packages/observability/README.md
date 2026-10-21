# @foc/observability

Shared **OpenTelemetry tracing** and **Prometheus metrics** for Friend on Campus services.

## What it provides

| Export | Purpose |
| --- | --- |
| `initTelemetry({ serviceName, otlpEndpoint })` | Initialize OpenTelemetry with instrumentation for Express, HTTP, PostgreSQL, RabbitMQ, Redis, and NestJS controllers. Must be called before `NestFactory.create()`. |
| `Telemetry.flush()` | Force-flush pending spans/logs. The SDK keeps running. |
| `Telemetry.shutdown()` | Force-flush, then gracefully stop the SDK. Safe to call repeatedly. |
| `registerShutdown(app, telemetry)` | On SIGINT/SIGTERM: close the Nest app (running all of its shutdown hooks), then flush and stop the SDK, then exit. Call once from `main.ts`, right after `NestFactory.create()`. |
| `initMetrics()` | Register default process metrics (CPU, RSS, GC, event loop). Idempotent. |
| `createMetricsHandler()` | Return an Express request handler that serves metrics at `/metrics`. |
| `createLabeledCounter(name, help, labelNames)` | Create a Prometheus counter with custom labels for domain-specific tracking. |
| `METRICS_PREFIX` | `'foc_'` — all metrics are prefixed to avoid collisions. |

## Adding `@foc/observability` to a service

The service must add the package as a local `file:` dependency and link it during build.

```json
{
  "dependencies": {
    "@foc/observability": "file:../packages/observability"
  },
  "scripts": {
    "obs:deps": "npm install --no-audit --no-fund --prefix ../packages/observability",
    "obs:build": "npm run build --prefix ../packages/observability",
    "obs:link": "npm install --install-links --no-audit --no-fund ../packages/observability",
    "prebuild": "npm run obs:build && npm run obs:link"
  }
}
```

During `npm install`, the service's `node_modules` receives a packed copy of the `dist` files rather than a host-specific symlink.

### Usage in a service

In `main.ts` (`initTelemetry` before `NestFactory.create`, `registerShutdown` after):

```ts
import {
  initTelemetry,
  registerShutdown,
  initMetrics,
  createMetricsHandler,
} from '@foc/observability';

const telemetry = initTelemetry({ serviceName: 'user-service' });
initMetrics();

const app = await NestFactory.create(AppModule);
// On SIGINT/SIGTERM: close the app (running its shutdown hooks), then flush
// and stop the SDK before the process exits.
registerShutdown(app, telemetry);
app.use('/metrics', createMetricsHandler());
```

### RabbitMQ context propagation

No changes are required to RabbitMQ consumers or publishers. The `@opentelemetry/instrumentation-amqplib` automatically injects and extracts trace context via message headers.

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs
npm run build # compile dist/ (consumers read dist/)
npm run lint  # oxlint
```
