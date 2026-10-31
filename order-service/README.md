# order-service

Errand lifecycle, state model and expiry. See `AGENTS.md` and `ARCHITECTURE.md`.

## Routes (`/v1/errands`, JWT required)

| Route | Role | Purpose |
|---|---|---|
| `GET /` | Courier | Browse open errands (`pickupBuilding`, `deliveryBuilding`, `minCredits`, `sort`, `limit`, `offset`) |
| `GET /mine` | Requester or Courier | The caller's errands as requester or courier (`role`, `status`, `limit`, `offset`) |
| `GET /:id` | Requester or Courier | One errand; 404 unless a party or the errand is open and unexpired |
| `POST /` | Requester | Create |
| `POST /:id/accept`, `pickup`, `deliver`, `withdraw` | Courier | Courier actions |
| `POST /:id/confirm`, `incomplete`, `adjust`, `cancel` | Requester | Requester actions |

## Admin routes (`/v1/admin`, JWT with `isAdmin`)

| Route | Purpose |
|---|---|
| `GET /users/:userId/errands` | A user's errands as requester or courier, with the internal sub-state (`role`, `status`, `limit`, `offset`) |

## Courier location tracking (`/v1/errands`, JWT required)

While an errand is `Picked Up`, the Courier reports their position and the Requester watches it. Positions live only in Redis (no history, never logged). Design: [ADR 0011](../docs/adr/order-service/0011-courier-location-tracking.md); spec and status: `order-map-review-spec.md`.

| Route | Role | Purpose |
|---|---|---|
| `POST /:id/location` | Courier (assigned) | Report a position; `204`. `400` (`INVALID_FIELDS` outside `TRACKING_BBOX`; other validation errors use Nest's default body, no `code`), `403 FORBIDDEN`, `404 NOT_FOUND`, `409 STATE_MISMATCH` unless `Picked Up`. An update sooner than `TRACKING_MIN_UPDATE_INTERVAL_MS` after the last accepted one is not stored and still answers `204` |
| `GET /:id/tracking` | Requester or Courier of the errand | SSE: `snapshot`, `location`, `route`, `ended`, plus a `keepalive` event (data `{}`) every `TRACKING_SSE_KEEPALIVE_MS`; the stream closes after `ended`, which is sent only for a real end (errand not found or not `Picked Up`; a failed status re-check skips that tick). Caps: `TRACKING_MAX_STREAMS_PER_ERRAND` (5) and `TRACKING_MAX_STREAMS_PER_USER` (10), over which the answer is `429 { code: 'TOO_MANY_STREAMS' }` |
| `GET /:id/tracking/snapshot` | Requester or Courier of the errand | JSON snapshot (first paint, polling fallback) |

In v1 there is no delivery destination yet, so the snapshot's `destination` and `route` are `null`; only the live position is shown.

### Running it

- **Redis.** order-service uses the shared `redis` service with its own DB index (`REDIS_DB_INDEX`, default 1) and the `order:` key prefix. `REDIS_HOST`, `REDIS_PORT` and `REDIS_USERNAME` are required config, but Redis is non-fatal: the service connects in the background with retry. While it is unavailable, `POST /location` and the tracking GETs answer `503 { code: 'TRACKING_UNAVAILABLE' }` and errand lifecycle is unaffected.
- **OSRM (optional, opt-in).** Routes need the `osrm` service, which is opt-in through the compose profile `routing`. It needs a one-off data preparation from `data/osm/singapore.osm.pbf` (provenance in `data/osm/README.md`) with `scripts/prepare-osrm.sh`, re-run when the map data is refreshed. Allow about 1 to 2 GB of RAM. Without OSRM, tracking still works but no route is returned. Point to it with `OSRM_BASE_URL` (default `http://osrm:5000`) and `OSRM_TIMEOUT_MS` (3000).
- **Tuning.** `TRACKING_LOCATION_TTL_S` (120), `TRACKING_ROUTE_TTL_S` (600), `TRACKING_MIN_UPDATE_INTERVAL_MS` (1000), `TRACKING_SSE_KEEPALIVE_MS` (20000), `TRACKING_REROUTE_DISTANCE_M` (50) and `TRACKING_BBOX` (`103.62,1.22,104.03,1.47` as `minLon,minLat,maxLon,maxLat`). All are listed in `../env/order-service.env.example`.

### Frontend

The Courier gets a share-location toggle on a picked-up errand, and the Requester a map card on the errand detail (`frontend/app/home/_errands/`). The map tile source is set with `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`; outside development one must be configured (the public OSM tile servers are not for production use), otherwise the card says tiles are not configured. The frontend dev container runs `npm run dev` (`NODE_ENV=development`), so a public OSM tile fallback is active when `NEXT_PUBLIC_MAP_TILE_URL` is empty. A production build needs `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` at build time and must not use the public OSM tiles.
