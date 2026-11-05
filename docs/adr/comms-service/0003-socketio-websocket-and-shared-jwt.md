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

We use the Socket.IO namespace `/chat` on the independently configured
transport path `SOCKET_PATH`, which defaults to `/socket.io`. Both server and
future client use `transports: ["websocket"]`; polling and upgrade fallback are
disabled.

Communication Service remains private on the `internal` network. The published
frontend server is its browser-facing ingress and proxies both Package 2 HTTP
chat routes and the Package 3 WebSocket path. The frontend runtime receives
`COMMS_SERVICE_URL=http://comms-service:3000`; the proxy preserves the request
query, `Cookie`, `Origin`, `Upgrade`, and `Connection` values and covers both
the socket base path and its subpaths. Root development therefore uses browser
origin `http://localhost:3001`, which must appear exactly in
`SOCKET_ALLOWED_ORIGINS`. Production ingress supplies its own exact origins;
wildcards and implicit origin reflection are prohibited.

The handshake rejects missing or unapproved origins and accepts the access
token only from the HTTP-only `access_token` cookie. Tokens in query strings,
auth payloads, events, or JavaScript-visible storage are prohibited. The
shared `AccessTokenVerifier` adds a backwards-compatible
`verifyWithMetadata(token)` method returning `{ user, expiresAt }`, where
`user` is the existing `AuthenticatedUser` and `expiresAt` is derived from the
already validated JWT `exp` claim. Existing `verify()` and HTTP guard behavior
remain unchanged. The gateway attaches only the verified user ID to socket
state, schedules disconnect at expiry, and clears the timer and admitted-chat
state on disconnect. Refresh requires a new authenticated handshake.

Every client command requires a Socket.IO acknowledgement callback and uses
the single discriminated response shape `{ ok: true, data }` or
`{ ok: false, error: { code, message } }`. Payloads are strict and reject
unknown properties. The client events are `chat:join { chatId }`,
`message:send { chatId, clientMessageId, content }`, and
`messages:read { chatId, throughSequence }`. The Package 3 server events are
`message:new` and `messages:read-receipt`; `chat:closing` and `chat:archived`
are reserved for Package 4. Sanitized errors use `UNAUTHENTICATED`,
`FORBIDDEN`, `NOT_FOUND`, `INVALID_REQUEST`, `INVALID_MESSAGE`,
`CHAT_ARCHIVED`, `CONFLICT`, or `INTERNAL_ERROR`. Unknown and unauthorized
chat IDs have the same observable response.

One socket represents exactly one opened conversation. `chat:join` proves
membership from PostgreSQL before room admission. Rejoining the admitted chat
is idempotent; joining another chat on the same socket returns `CONFLICT` and
does not move rooms. The only application room joined is
`chat:{chatId}:user:{verifiedUserId}`, constructed from verified identity and
the authorized database row. Send and read payloads must name the admitted
chat and are reauthorized inside their database transaction.

After a new message commits, `message:new` is emitted to the recipient's room
and to the sender's room excluding the initiating socket, so other sender tabs
converge without echoing the acknowledgement back to its caller. After a read
update commits, `messages:read-receipt` is emitted only to the affected
sender's room. An idempotent send retry or read no-op emits nothing.

The Socket.IO Redis adapter provides fan-out between replicas. PostgreSQL
remains authoritative: reconnect recovery reads message history and read state
from PostgreSQL, not Redis. The adapter uses dedicated publisher and subscriber
connections; it stores no message, membership, sequence, read state, or replay
truth. `chat:join` returns the latest committed sequence so a client can detect
gaps and recover through Package 2 HTTP history. Socket emission remains
best-effort after commit.

## Consequences

- Deployments must route the configured socket path on the same site as the
  frontend, preserve WebSocket upgrades and cookies, and keep Communication
  Service off the public network.
- There is no long-polling fallback; proxies must support WebSockets.
- Redis loss can interrupt live fan-out but cannot lose committed messages.
- Cookie, origin, participant, and token-expiry checks are mandatory gateway
  boundaries.
- Message acknowledgements describe committed state rather than optimistic
  delivery.
- A socket cannot switch conversations; opening another conversation requires
  a separate socket or reconnect.
- User-scoped rooms prevent a receipt or message from being broadcast to the
  other participant unnecessarily while still supporting multiple tabs and
  replicas.
- Metrics and logs may describe bounded operation and outcome classes, but
  never use participant, chat, message, token, cookie, or content values as
  metric labels or log payloads.

## Requirement Traceability

This decision governs Package 3 issues #672-#674 and #681, and the realtime
receipt transport used by #676-#680. Package 5 owns browser socket lifecycle,
refresh/reconnect behavior, and visible receipt rendering.
