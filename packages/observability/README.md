# @foc/observability

Shared **OpenTelemetry tracing** and **Prometheus metrics** for Friend on Campus services.

## What it provides

| Export | Purpose |
| --- | --- |
| `initTelemetry({ serviceName, otlpEndpoint })` | Initialize OpenTelemetry with instrumentation for Express, HTTP, PostgreSQL, RabbitMQ, Redis, and NestJS controllers. Must be called before `NestFactory.create()`. |
| `Telemetry.flush()` / `Telemetry.shutdown()` | Force-flush pending spans, then gracefully shut down the SDK. |
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

In `main.ts` (must be before `NestFactory.create`):

```ts
import { initTelemetry, initMetrics, createMetricsHandler } from '@foc/observability';

initTelemetry({ serviceName: 'user-service' });
initMetrics();

const app = await NestFactory.create(AppModule);
app.get('/metrics', createMetricsHandler());
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
