# Courier location tracking: research and implementation spec

Status: **draft for review, nothing implemented.** Branch: `features/order-service/map-preview`. Owner service: `order-service`, with a frontend slice.

## 1. Goal

Once a Courier has picked up an Errand (`Picked Up`), the Requester can watch the Courier move on a map, with a route and ETA to the delivery point, until the Errand is `Delivered` (or leaves `Picked Up` some other way). Tracking is a convenience, not part of the state model: it must never block or change a lifecycle transition.

Constraints from the reference notes (the attached slide), kept as-is unless §9 says otherwise:

| Decision in reference | Meaning here |
|---|---|
| Tracking only works while the browser stays open | The Courier's browser reports its position; there is no native app or background tracking. Position stops when the tab is closed or backgrounded. |
| Redis, temporal, no durability | Last-known position is held in Redis with a TTL. Never written to Postgres or the event log. |
| Requester receives updates via SSE | One-way server→browser stream. Courier→server is a plain HTTP POST. |
| Routes via OSRM + OSM data, or Mapbox Directions | See §5; recommendation is OSRM. |
| Render with Leaflet / MapLibre | See §6; recommendation is MapLibre GL JS or Leaflet (decision in §9). |
| Lifecycle coupling, Pickup → Delivery | Tracking is allowed exactly while the Errand is `Picked Up`. |

## 2. What the repo already gives us (research findings)

- **Lifecycle edges to hook into** (`order-service/ARCHITECTURE.md` §2, `src/lifecycle/status.ts`): edge 10 `Accepted → Picked Up` (`POST /v1/errands/:id/pickup`, courier) starts tracking; edge 12 `Picked Up → Delivered` and edge 13 `Picked Up → Cancelled` (`PICKUP_TIME_EXCEEDED`, sweep, 24h) end it. Only the Lifecycle module writes errand state, and tracking must **not** go through `transition()` (it is not a state change).
- **Auth**: `JwtAuthGuard` reads the httpOnly `access_token` cookie before the Bearer header (`src/http/configure-http.ts`). The browser's `EventSource` cannot set headers but does send same-origin cookies, so SSE works with the existing guard as long as the request is same-origin. The frontend reaches order-service through Next.js `/api/*` rewrites (`env/frontend.env.example`), which is same-origin. **Risk**: the Next rewrite proxy must not buffer or time out a long-lived `text/event-stream` response. This needs a spike (§8, step 0).
- **Authorization model** ("identity, role, relationship"): a route's role is a first gate and the handler then checks the caller is that Errand's Requester or Courier. Tracking follows the same rule: only the assigned Courier may publish, only the Requester (and optionally an Admin) may subscribe.
- **Redis**: a shared `redis` service exists (defined in `user-service/compose.yml`, `redis:latest`, health-checked, env in `env/shared.env.example`: `REDIS_HOST/PORT/USERNAME/DB_INDEX`). `user-service` and `email-service` already use the `redis` npm package (`^6.2.1`). order-service has **no Redis dependency yet**: it needs the client, env vars, a `depends_on`, and a key namespace so it cannot collide with user/email keys.
- **Coordinates**: supplier-service stores building coordinates (`SEED_BUILDINGS`, `data/csv/supplier-seed-data.csv` has per-supplier lat/long), and the `supplier-validation-completed` contract already carries `coordinates: { latitude, longitude }`. order-service stores `pickup_location` as the building short name, **not** coordinates, and `delivery_location` is free client text (`schema.ts`; ARCHITECTURE "known gap"). So a destination point for the route is **not currently available** to order-service. See §4.3.
- **Overlap to check**: remote branch `features/order-service/Add-delivery-location-verification` suggests delivery location handling is being changed. Coordinate with that work before choosing how the destination is stored.
- **No existing SSE, map, or geolocation code** in any service or in the Next.js frontend (Next 16, React 19; `frontend/AGENTS.md` warns Next APIs differ from training data, so read `node_modules/next/dist/docs/` before frontend work).

## 3. Options researched

### 3.1 Transport: Courier → server

Browser `navigator.geolocation.watchPosition()` (needs HTTPS or localhost, and user permission) feeding `POST /v1/errands/:id/location`, throttled client-side to about one update per 5 s, and only sent if the position moved or on a heartbeat (~15 s). WebSocket was considered and rejected: the reference picks SSE, and a throttled POST keeps the existing auth, rate limiting and tracing intact.

### 3.2 Transport: server → Requester

SSE (`text/event-stream`) via NestJS `@Sse()` returning an RxJS `Observable` (rxjs is already a dependency). Gives automatic reconnect with `Last-Event-ID`, works over HTTP/1.1 and cookies, no new dependency. Needs `X-Accel-Buffering: no` / `Cache-Control: no-cache` and a keep-alive comment every ~15–25 s so proxies don't close idle streams.

### 3.3 Fan-out across instances

If order-service ever runs more than one instance, a POST can land on a different instance from the SSE connection. Use **Redis pub/sub** (`PUBLISH errand-loc:<id>`): the instance that receives the POST publishes, every instance with a subscriber forwards. With a single instance this still works and costs nothing extra. Redis pub/sub is fire-and-forget, which matches "temporal, no durability". The SSE handler sends the current stored position first, then live updates.

### 3.4 Storage (Redis)

| Key | Value | TTL |
|---|---|---|
| `order:loc:<errandId>` | JSON `{lat, lng, accuracy, heading?, speed?, ts}` (last known) | 120 s, refreshed on each update |
| `order:route:<errandId>` | JSON `{polyline, distanceM, durationS, computedAt, fromLat, fromLng}` (cached route) | 10 min |

Staleness is derived from `ts`; the UI shows "last seen N s ago" and greys the marker after about 60 s. Keys are deleted on `Delivered`/`Cancelled`; the TTL is the safety net. Redis key namespace prefix `order:` plus a dedicated `REDIS_DB_INDEX` for order-service keeps it apart from user-service/email-service.

### 3.5 Routing

| | OSRM (self-hosted, OSM data) | Mapbox Directions API |
|---|---|---|
| Cost | Free; we host a container | Free tier, then per-request; needs a billing-capable account |
| Setup | Download the Singapore/Malaysia OSM extract, run `osrm-extract` / `osrm-partition` / `osrm-customize` once, then `osrm-routed --algorithm mld`; foot profile | Access token only |
| Walking profile | Yes (`foot.lua`) | Yes (`walking`) |
| Campus paths quality | Depends on OSM; NUS paths are generally mapped, verify during the spike | Generally good, same OSM base plus proprietary data |
| Secrets | None | Token (Docker secret, never in the browser if routing is proxied) |
| Fits this repo | One more compose service, fits existing "everything in Docker" approach | Outbound call needs the network policy/proxy allowed, token management |

**Recommendation: OSRM**, called server-side by order-service (the browser never talks to OSRM), result cached in Redis and recomputed only when the Courier has moved more than ~50 m from the last route origin or every ~60 s. Fallback: if OSRM is down, return no route and just show the live marker (degrade, don't fail). Mapbox stays a swap-in behind a small `RoutingProvider` interface.

### 3.6 Map rendering

| | Leaflet | MapLibre GL JS |
|---|---|---|
| Rendering | DOM/raster tiles | WebGL vector tiles |
| Weight / simplicity | Small, trivial marker + polyline | Heavier, smoother pan/zoom/rotation |
| Tiles | Raster from a tile provider | Vector style needed (self-hosted or provider) |
| Next/React | `react-leaflet`; must be loaded client-only (no SSR, `window` access) | `react-map-gl` or direct; also client-only |

**Tiles are the real issue, not the library.** The public `tile.openstreetmap.org` servers forbid heavy/production use. Options: a hosted tile provider's free tier (e.g. MapTiler, Stadia, or Mapbox tiles), or self-hosting tiles. **Recommendation: Leaflet** for this scope (one marker, one polyline, one destination pin), with the tile URL as a config value, and an attribution control (OSM attribution is mandatory). Move to MapLibre only if vector tiles/smooth animation are wanted.

## 4. Design

### 4.1 API (order-service, new `src/tracking/` module)

All under the existing `JwtAuthGuard` + `RolesGuard`.

| Route | Who | Behaviour |
|---|---|---|
| `POST /v1/errands/:id/location` | assigned Courier | Body `{lat, lng, accuracy?, heading?, speed?}` (validated ranges). 204 on success. `409 STATE_MISMATCH` unless the Errand is `Picked Up`; `403 FORBIDDEN` if caller isn't its Courier; rate-limited (e.g. ≥1 s between accepted updates, extras dropped with 204). Stores position, publishes to pub/sub. |
| `GET /v1/errands/:id/tracking` (SSE) | the Errand's Requester (Admin read optional) | Same status/relationship checks. Sends an initial `snapshot` event (last position, route, destination, status), then `location`, `route` and `ended` events. Closes with `ended` when the Errand leaves `Picked Up`. |
| `GET /v1/errands/:id/tracking/snapshot` | same as SSE | Plain JSON of the snapshot, for the first paint and as a polling fallback if SSE is blocked. |

Errors reuse the existing `{ code, message }` shape (`result-to-http.ts`) so `frontend/lib/api.ts` handles them unchanged.

### 4.2 Lifecycle coupling

- **Start**: tracking is *available* from the moment the Errand is `Picked Up`; there is no explicit start call. The POST's status check is the gate.
- **End**: when an Errand leaves `Picked Up` (Delivered, `PICKUP_TIME_EXCEEDED`), tracking must stop. Preferred mechanism: the status check on each POST/SSE keepalive plus a Redis `DEL` and `ended` publish performed **after commit** by the code that called `transition()` for edges 12/13 (an in-process hook, not an outbox notice, since it is best-effort). If the hook is missed (crash), the 120 s TTL and the status check cover it. No new state, no schema change, no migration for tracking itself.
- Keep to the rule that only the Lifecycle module writes errand state: the tracking module only **reads** the errand row.

### 4.3 Destination coordinates (needs a decision, §9)

Route needs a start (Courier) and end (delivery point). Pickup point is available from the supplier snapshot's coordinates. For the delivery point, options:

1. Resolve `delivery_location` to a building coordinate by asking supplier-service/building data (the frontend already sends a building short name).
2. Requester picks the delivery point on the map at creation and order-service stores `delivery_lat/lng` (new nullable columns + migration; changes the create contract).
3. v1 shows only the Courier marker and pickup pin with no route; routes added once delivery coordinates exist.

Recommendation: 1 for v1 (no contract change), flagged against the in-flight delivery-location-verification work.

### 4.4 Privacy and safety

- Positions are shared only between the Errand's two parties; never listed, never in logs (log errand id and event counts, not coordinates; the existing pino/OTel setup must not capture request bodies for this route).
- Courier must be told clearly that location is shared with the Requester until delivery, and grant browser permission explicitly; the UI shows a visible "sharing location" state and an off switch (tracking is optional; delivery still works without it).
- No history is kept (Redis TTL only), so there is nothing to retain, export or delete. State this in the ADR.
- Coarse sanity checks server-side: reject coordinates outside a campus-area bounding box (configurable) to limit spoofed or junk data; this is a convenience filter, not a security control.

### 4.5 Config (new env vars; each must be added to `src/config/environment.schema.ts`, `order-service/compose.yml`, and `env/order-service.env.example`)

`REDIS_HOST/PORT/USERNAME/DB_INDEX` (+ password secret if Redis gets one), `TRACKING_LOCATION_TTL_S` (120), `TRACKING_MIN_UPDATE_INTERVAL_MS` (1000), `TRACKING_SSE_KEEPALIVE_MS` (20000), `TRACKING_BBOX` (campus box), `OSRM_BASE_URL` (`http://osrm:5000`), `OSRM_TIMEOUT_MS`, `TRACKING_REROUTE_DISTANCE_M` (50), `TRACKING_ROUTE_TTL_S`. Frontend: tile URL template and attribution (public, so `NEXT_PUBLIC_*` via `env/frontend.env.example`).

### 4.6 Infrastructure

- `osrm` compose service (OSRM backend image + volume with preprocessed Singapore/Malaysia extract, foot profile), and a one-off preprocessing script under `scripts/`. Data volume is large (hundreds of MB for the extract); extraction only needs to be re-run when map data is refreshed.
- order-service gains `depends_on: redis` (and `osrm` as non-blocking).
- Pin the Redis image version for shared use (currently `redis:latest`; pre-existing, flag only).

## 5. Implementation steps

0. **Spike (about half a day, throwaway)**: confirm SSE passes through the Next rewrite unbuffered and with cookie auth; confirm OSRM `foot` routes work on NUS paths; confirm the chosen tile provider's limits.
1. **ADR** `docs/adr/order-service/0011-courier-location-tracking.md`: Redis-only/no durability, SSE + pub/sub, OSRM choice, privacy position. Update `ARCHITECTURE.md` (components diagram, a new "Tracking" section) and `CONTEXT.md` (term "Tracking session / last-known position"); root `CONTEXT.md` only if new shared terms appear.
2. **Infra**: Redis client + env vars + compose wiring in order-service; `osrm` service + prep script.
3. **Tracking module**: Redis store, pub/sub, `RoutingProvider` (OSRM impl, Redis cache, degrade-on-failure), guards for Courier/Requester relationship, POST + SSE + snapshot endpoints, DTO validation.
4. **Lifecycle hook**: post-commit end-of-tracking on edges 12/13 without touching `transition()` semantics.
5. **Contracts**: if the frontend needs shared types, add to `@foc/contracts`; no domain-event change is expected (nothing leaves order-service over RabbitMQ).
6. **Frontend**: Courier "share my location" toggle on the picked-up errand (watchPosition → throttled POST, handles permission denied/unsupported/tab-hidden warnings); Requester map card on the errand detail (Leaflet, client-only dynamic import, marker, polyline, ETA, stale/ended states, reconnect/backoff, snapshot fallback).
7. **Tests**: unit (DTO ranges, rate limit, auth matrix: courier/requester/stranger/wrong status, route cache/reroute thresholds, OSRM failure degrade), e2e against a test Redis (POST→SSE delivery, end on Delivered), no coordinate leakage in logs. Run `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` in order-service, and the frontend lint/build.
8. **Docs**: README/env docs, how to prepare OSRM data, how to run the stack.

Suggested slicing into PRs: (a) ADR + infra, (b) backend tracking, (c) frontend courier sender, (d) frontend requester map + route.

## 6. Risks and open technical questions

- **Background tabs**: browsers throttle timers and may suspend geolocation in hidden tabs/locked phones. Expect gaps; the UI must communicate "last seen". This is inherent to the "browser stays open" decision.
- **SSE through the Next proxy** and any production reverse proxy (buffering, idle timeouts): validate in the spike.
- **Location accuracy indoors** (campus buildings): show the accuracy circle, don't snap to road/path blindly.
- **Redis is shared and unpinned, with no auth config visible**: positions are personal data; confirm Redis is not exposed beyond the compose network (it publishes `${REDIS_PORT}` to the host today).
- **OSM path coverage and OSRM data size** on dev machines and CI.
- **Tile provider terms** (no heavy use of OSM's public tiles).

## 7. Out of scope

Persistent location history, replay, Courier tracking before pickup, background/native tracking, push notifications for proximity, ETA-driven credit logic, admin live-map views, multi-stop routing.

## 8. What I need from you

1. **Decisions** (§9): routing provider, map library/tiles, delivery-point approach, whether Admins may view tracking.
2. **Accounts/keys** (only if the choice requires them): a tile provider API key (MapTiler/Stadia/Mapbox free tier) or confirmation to self-host tiles; a Mapbox token only if you choose Mapbox over OSRM.
3. **OSM extract**: OK to download the Geofabrik Malaysia/Singapore/Brunei extract in Docker, or a smaller campus-area extract you prefer; and the machine/disk budget for an extra container.
4. **Environment access**: the compose stack must be runnable somewhere I can test (this cloud container may block outbound downloads such as OSM data or tiles; I'd confirm network policy first), and a way to test geolocation (HTTPS or localhost; real device or browser location emulation).
5. **Coordination**: whoever owns `features/order-service/Add-delivery-location-verification`, since destination coordinates overlap with it.
6. **Redis**: confirm order-service may share the existing `redis` service (with its own DB index and prefix), or whether you want a separate instance.
7. **Privacy sign-off**: is the in-app consent/notice wording acceptable for your course/project context, and is a campus bounding box fine for the sanity filter?
8. **Next.js**: confirmation that I should follow `frontend/AGENTS.md` and read the bundled Next 16 docs before the frontend work (I will).

## 9. Decisions proposed (defaults if you don't object)

| # | Question | Proposed default |
|---|---|---|
| 1 | Routing | Self-hosted OSRM (foot), server-side, behind a `RoutingProvider` interface |
| 2 | Map library | Leaflet (client-only), tile URL configurable; hosted free-tier tiles |
| 3 | Delivery point | Resolve from building data (option 1 in §4.3); no route until available |
| 4 | Fan-out | Redis pub/sub from day one |
| 5 | Admin viewing | Not in v1 |
| 6 | Update cadence | Courier POST every ~5 s while moving, 15 s heartbeat; stale after 60 s; TTL 120 s |
| 7 | Branch/PRs | All work on `features/order-service/map-preview`; no PR until you ask |
