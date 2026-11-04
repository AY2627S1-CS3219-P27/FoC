# Socket.IO over WebSocket with shared JWT authentication

## Context

The chat UI needs bidirectional delivery, acknowledgements, reconnect-safe
sends, and cross-replica fan-out. FoC already authenticates browser requests
with the User Service access-token cookie. That cookie is HTTP-only and must
not be copied into JavaScript-accessible storage or a socket query string.

Socket delivery is transient: a disconnected recipient must recover committed
history later, and users connected to different Communication Service replicas
must receive the same committed events.

## Decision

Package 3 will use Socket.IO configured with `transports: ["websocket"]` and no
polling fallback. The frontend will reach the socket path through the same-site
deployment route so the browser sends the existing `access_token` cookie in
the handshake.

The gateway will verify that cookie with the shared `AccessTokenVerifier`,
allow only configured origins, authorize chat participation, and disconnect a
socket when its JWT expires. It will acknowledge sends and reads only after the
corresponding PostgreSQL transaction commits.

The Socket.IO Redis adapter will provide fan-out between replicas. PostgreSQL
remains authoritative: reconnect recovery reads message history and read state
from PostgreSQL, not Redis. Configuration and dependencies are reserved in
Package 1, but no socket namespace or unauthenticated endpoint is exposed yet.

## Consequences

- Deployments must route the configured socket path on the same site as the
  frontend and preserve WebSocket upgrades.
- There is no long-polling fallback; proxies must support WebSockets.
- Redis loss can interrupt live fan-out but cannot lose committed messages.
- Cookie, origin, participant, and token-expiry checks are mandatory gateway
  boundaries.
- Message acknowledgements describe committed state rather than optimistic
  delivery.
