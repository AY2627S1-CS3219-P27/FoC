# Courier location tracking: Redis only, SSE to the Requester, routes from OSRM

## Context

Once a Courier has picked up an Errand, the Requester wants to see where the
Courier is until delivery. This is a convenience, not part of the state model:
it must never block or change a lifecycle transition, and the Courier's
position is personal data that nobody needs after the delivery. The
requirements and research are in
[`order-map-review-spec.md`](../../../order-service/order-map-review-spec.md).

The reference decisions for the feature were fixed up front: the Courier's
browser reports its position (no native or background tracking), positions live
in Redis with no durability, the Requester receives updates over SSE, and
routes come from OSRM over OSM data.

## Decision

- **Available exactly while `Picked Up`.** There is no start call. The status
  check on each request is the gate. Tracking never calls `transition()` and
  never writes errand state; the tracking module only reads the errand row.
- **Redis only, no durability.** Nothing is written to Postgres or the event
  log, and no history is kept.

  | Key / channel | Value | TTL |
  |---|---|---|
  | `order:loc:<errandId>` | last position JSON `{lat, lng, accuracy, heading, speed, ts}` | `TRACKING_LOCATION_TTL_S` (120 s), refreshed on each accepted update |
  | `order:route:<errandId>` | cached route | `TRACKING_ROUTE_TTL_S` (600 s) |
  | `order:loc-events:<errandId>` (pub/sub) | live events | none (fire and forget) |

  order-service uses its own Redis DB index (`REDIS_DB_INDEX`, default 1) and
  the `order:` prefix, so its keys cannot collide with user-service or
  email-service on the shared `redis` service.
- **Courier to server is a plain HTTP POST.** `POST /v1/errands/:id/location`,
  204 on success. Only the assigned Courier may call it. An Errand that is not
  `Picked Up` gives `409 STATE_MISMATCH`; anyone else gets `403 FORBIDDEN`.
  Positions outside `TRACKING_BBOX` (`minLon,minLat,maxLon,maxLat`), or arriving
  faster than `TRACKING_MIN_UPDATE_INTERVAL_MS`, are dropped or rejected by the
  backend. The box is a convenience filter, not a security control.
- **Server to Requester is SSE.** `GET /v1/errands/:id/tracking` sends the
  events `snapshot`, `location`, `route` and `ended`, with a keep-alive comment
  every `TRACKING_SSE_KEEPALIVE_MS`. `GET /v1/errands/:id/tracking/snapshot`
  returns the same snapshot as JSON for the first paint and as a polling
  fallback. Both are open to the Errand's Requester or Courier; v1 has no Admin
  view. All three routes sit behind `JwtAuthGuard` and `RolesGuard`.
- **Redis pub/sub for fan-out.** The instance that receives a POST publishes to
  `order:loc-events:<errandId>`, and every instance holding a subscriber
  forwards it. With one instance this costs nothing extra. A new SSE connection
  first sends the stored position, then live events.
- **Snapshot shape.** `{ errandId, status, tracking, position, route, destination, serverTime }`.
  `tracking` is true while the Errand is `Picked Up`. `position` is the
  last-known position or `null`. `route` is
  `{ polyline: [[lng, lat], ...], distanceM, durationS, computedAt }` or `null`.
  `destination` is `{ lat, lng }` or `null`.
- **Ending tracking.** Edge 12 (`Picked Up` → `Delivered`) and edge 13
  (`PICKUP_TIME_EXCEEDED` cancel) run a best-effort hook after the commit: delete
  the keys and publish `ended`. It is an in-process call, not an outbox notice,
  and a failure never fails or rolls back the transition. If the hook is missed
  (crash), the status check on the next request and the position TTL cover it.
- **Routing through a `RoutingProvider`.** The implementation is OSRM (foot
  profile, Singapore extract at `data/osm/singapore.osm.pbf`), called
  server-side at `OSRM_BASE_URL` with `OSRM_TIMEOUT_MS`; the browser never talks
  to OSRM. A route is cached and recomputed only when the Courier has moved more
  than `TRACKING_REROUTE_DISTANCE_M` from the cached route's origin. If OSRM
  fails or times out, the snapshot has no route and the live position still
  flows (degrade, don't fail).
- **No destination yet.** `delivery_location` is free client text and
  order-service stores no delivery coordinates. A `DestinationResolver` stub
  returns `null`, so `destination` and `route` are `null` in v1. The pieces for
  routing exist, but routes are not produced end to end until delivery
  coordinates exist. How they are sourced is open and overlaps the delivery
  location work in progress on another branch.
- **Privacy.** A position is shared only between the Errand's two parties,
  never listed, and not logged (log the Errand id and event counts, not
  coordinates). No history is kept, so there is nothing to retain, export or
  delete. Sharing is optional; delivery works without it.

## Consequences

- No migration and no schema change. The state model, the write path and the
  outbox are untouched; nothing leaves order-service over RabbitMQ for tracking.
- order-service gains a Redis dependency (client, `REDIS_*` env vars,
  `depends_on`) and an optional OSRM one. Redis down means no tracking, not
  failed lifecycle transitions. OSRM down means no route.
- Pub/sub is fire and forget, so a client that was disconnected misses events.
  It recovers from the snapshot on reconnect, which matches "temporal, no
  durability".
- Updates stop when the Courier's tab is closed or backgrounded, so the
  position goes stale; the UI shows how long ago it was seen. After the TTL the
  snapshot returns `position: null`.
- The shared `redis` service is currently unpinned, publishes its port to the
  host and shows no auth configuration. Positions are personal data, so
  confirm it is not reachable beyond the compose network before relying on it.
- The OSRM data must be prepared once before the `osrm` service starts, and
  redone when the map data is refreshed. Runtime needs about 1 to 2 GB of RAM.
- The best-effort end hook can be missed, so a Requester may briefly see the
  last position after delivery until the next status check or the TTL.
- SSE through the frontend's Next.js rewrite must not be buffered or timed out;
  this is unverified and is a spike item in the spec.

## Alternatives rejected

- **Postgres or the event log for positions.** Needs retention and deletion, adds
  write load on the database that owns errand state, and nothing needs history.
- **WebSocket.** The reference picks SSE, and a throttled POST keeps the existing
  auth, rate limiting and tracing intact.
- **Tracking as a lifecycle state or event.** A position is not a state change,
  and routing it through `transition()` would let a Redis or OSRM fault block
  deliveries.
- **Mapbox Directions.** Needs a token, an outbound call and billing. It can be
  swapped in behind `RoutingProvider` later.
- **Outbox for the end-of-tracking signal.** Guaranteed delivery buys nothing
  for a best-effort signal that the TTL already backstops.
