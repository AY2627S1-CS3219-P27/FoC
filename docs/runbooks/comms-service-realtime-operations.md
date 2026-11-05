# Communication Service realtime operations

This runbook covers the Communication Service Socket.IO gateway and Redis
adapter. Redis is transient fan-out infrastructure. PostgreSQL remains
authoritative for every message, sequence, and read timestamp, and the
authenticated HTTP history API is the only recovery path.

## Signals

`GET /health/live` proves only that the process can answer HTTP.
`GET /health/ready` checks PostgreSQL, RabbitMQ, the application Redis client, and
both dedicated Socket.IO adapter connections. A failed adapter publisher or
subscriber therefore removes the replica from readiness without changing
already committed chat data.

Monitor these bounded metrics:

- `foc_comms_socket_handshakes_total{outcome}`;
- `foc_comms_socket_active`;
- `foc_comms_socket_operations_total{operation,outcome}`;
- `foc_comms_socket_operation_duration_seconds{operation,outcome}`; and
- `foc_comms_socket_adapter_errors_total{role}`.

Alert on sustained readiness failure, increasing adapter errors, elevated
`internal` operation outcomes, or a material handshake-rejection shift. Do not
add chat, user, participant, message, cookie, token, or content values to
metrics or logs.

## Redis interruption

During an interruption, local PostgreSQL transactions can still commit and
their acknowledgements remain successful. Live delivery to sockets on other
replicas may be missed. Do not retry or roll back a committed transaction based
on an adapter error, and do not reconstruct state from Redis.

1. Confirm PostgreSQL readiness and inspect the adapter-error rate by bounded
   `role` only.
2. Restore Redis connectivity. The node-redis clients reconnect automatically;
   readiness returns only after both adapter clients answer `PING`.
3. Have clients reconnect, call `chat:join`, compare `latestSequence`, and fetch
   authenticated HTTP history for every missing sequence.
4. For read status, refetch committed history/list state and reissue the
   idempotent `messages:read` command when appropriate.

No Redis purge, message replay, database rewrite, or read-timestamp repair is
part of ordinary recovery.

## Cross-replica verification

Run the isolated adapter test from `comms-service`:

```powershell
npm run socket:test:up
npm run test:socket-integration
npm run socket:test:down
```

It connects clients to two independent Socket.IO servers and proves that
`message:new` and `messages:read-receipt` cross replicas through Redis. In a
deployed environment, additionally connect two authorized tabs through
different replicas, join the same chat, and verify both events while checking
that metrics contain no identifiers.

Verify the browser-facing ingress separately:

1. Request `/api/chats` through the frontend origin and confirm it reaches
   Communication Service without exposing a service host port.
2. Connect to the frontend origin on `SOCKET_PATH` with WebSocket transport
   only, the HTTP-only access-token cookie, and an allowed `Origin`.
3. Confirm the `/chat` namespace joins successfully and that query parameters,
   `Cookie`, `Origin`, `Upgrade`, and `Connection` survive the proxy boundary.
4. Reject polling, direct service access, missing cookies, and origins not in
   the exact allowlist.

## Rollout and rollback

Apply the realtime database migration first, verify Redis health, then deploy
Communication Service. Startup connects the dedicated publisher and subscriber before
the Socket.IO adapter is registered or traffic is accepted. After deployment,
verify readiness, handshake acceptance, room admission, committed sends and
reads, and cross-replica delivery.

To roll back, stop routing new WebSocket upgrades and drain or stop the affected
Communication Service instances. Keep PostgreSQL and Redis intact. Do not erase messages or read
timestamps, purge Redis as a recovery mechanism, or revert a populated
migration during an ordinary application rollback. Reconnecting clients recover
from PostgreSQL through HTTP history and latest-sequence reconciliation.
