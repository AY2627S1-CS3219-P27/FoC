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
  A position outside `TRACKING_BBOX` (`minLon,minLat,maxLon,maxLat`) is rejected
  with `400 INVALID_FIELDS`. An update arriving sooner than
  `TRACKING_MIN_UPDATE_INTERVAL_MS` after the last accepted one is not stored or
  published, and still answers `204`. Other validation errors (bad ranges, a
  non-UUID id) use Nest's default 400 body, which has no `code`. The box is a
  convenience filter, not a security control.
- **Server to Requester is SSE.** `GET /v1/errands/:id/tracking` sends the
  events `snapshot`, `location`, `route` and `ended`, with a named
  `keepalive` event (data `{}`, not an SSE comment) every
  `TRACKING_SSE_KEEPALIVE_MS`. `GET /v1/errands/:id/tracking/snapshot`
  returns the same snapshot as JSON for the first paint and as a polling
  fallback. Both are open to the Errand's Requester or Courier; v1 has no Admin
  view. All three routes sit behind `JwtAuthGuard` and `RolesGuard`.
- **Redis pub/sub for fan-out.** The instance that receives a POST publishes to
  `order:loc-events:<errandId>`, and every instance holding a subscriber
  forwards it. With one instance this costs nothing extra. A new SSE connection
  subscribes first and buffers events, then reads and sends the snapshot, then
  flushes the buffer, so no update falls in the gap. The client ignores any
  position older (by `ts`) than the one it shows.
- **Snapshot shape.** `{ errandId, status, tracking, position, route, destination, serverTime }`.
  `tracking` is true while the Errand is `Picked Up`. `position` is the
  last-known position or `null`. `route` is
  `{ polyline: [[lng, lat], ...], distanceM, durationS, computedAt }` or `null`.
  `destination` is `{ lat, lng }` or `null`.
- **Ending tracking.** Four mechanisms, in order of speed. (1) Edge 12
  (`Picked Up` → `Delivered`) and edge 13 (`PICKUP_TIME_EXCEEDED` cancel) run a
  best-effort hook after the commit: delete the keys and publish `ended`. It is
  an in-process call, not an outbox notice, and a failure never fails or rolls
  back the transition. (2) Each open stream re-reads the errand on every
  keepalive tick and, if it is no longer `Picked Up`, sends `ended` and closes,
  so a missed hook does not leave a stream open. (3) Every request checks the
  status, and a location POST re-checks it after writing and clears the key if
  the errand left `Picked Up` meanwhile, so a POST racing delivery leaves no
  position. (4) The position TTL.
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
- A rate-limited update is dropped, so a Courier who posts faster than the
  interval just has some updates ignored.
- Pub/sub is fire and forget, so a client that was disconnected misses events.
  It recovers from the snapshot on reconnect, which matches "temporal, no
  durability".
- Updates stop when the Courier's tab is closed or backgrounded, so the
  position goes stale; the UI shows how long ago it was seen. After the TTL the
  snapshot returns `position: null`.
- The shared `redis` service is currently unpinned, publishes its port to the
  host and shows no auth configuration. Positions are personal data, so
  confirm it is not reachable beyond the compose network before relying on it.
- `osrm` is opt-in through the compose profile `routing`, so the default stack
  does not start it. Its data must be prepared once (`scripts/prepare-osrm.sh`)
  from the extract at `data/osm/singapore.osm.pbf`, and redone when the map data
  is refreshed. Provenance of the extract is in `data/osm/README.md`. Runtime
  needs about 1 to 2 GB of RAM.
- The end hook can be missed, so a Requester may see the last position until the
  next keepalive tick (at most `TRACKING_SSE_KEEPALIVE_MS`) ends the stream; a
  client that is not streaming sees `tracking: false` on its next snapshot.
- SSE through the frontend's Next.js rewrite must not be buffered or timed out.
  Mitigations are decided (compression off for the stream, a client watchdog
  that treats a silent stream as dead, and falling back to polling the
  snapshot), but it is still unverified end to end.
- order-service now requires `REDIS_HOST`, `REDIS_PORT` and `REDIS_USERNAME` to
  boot, even where tracking is unused.
- The frontend has a Courier share toggle and a Requester map card (Leaflet).
  The tile source is configured with `NEXT_PUBLIC_MAP_TILE_URL` and
  `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`; outside development the map needs one set
  (the public OSM tile servers are not for production use), else the card shows
  that tiles are not configured.

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
