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
| `POST /:id/location` | Courier (assigned) | Report a position; `204`; `409 STATE_MISMATCH` unless `Picked Up` |
| `GET /:id/tracking` | Requester or Courier of the errand | SSE: `snapshot`, `location`, `route`, `ended` |
| `GET /:id/tracking/snapshot` | Requester or Courier of the errand | JSON snapshot (first paint, polling fallback) |

In v1 there is no delivery destination yet, so the snapshot's `destination` and `route` are `null`; only the live position is shown.

### Running it

- **Redis.** order-service uses the shared `redis` service with its own DB index (`REDIS_DB_INDEX`, default 1) and the `order:` key prefix. Settings are `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME` and `REDIS_DB_INDEX`.
- **OSRM (optional).** Routes need the `osrm` service, which needs a one-off data preparation from `data/osm/singapore.osm.pbf` with `scripts/prepare-osrm.sh`, re-run when the map data is refreshed. Allow about 1 to 2 GB of RAM. Without OSRM, tracking still works but no route is returned. Point to it with `OSRM_BASE_URL` (default `http://osrm:5000`) and `OSRM_TIMEOUT_MS` (3000).
- **Tuning.** `TRACKING_LOCATION_TTL_S` (120), `TRACKING_ROUTE_TTL_S` (600), `TRACKING_MIN_UPDATE_INTERVAL_MS` (1000), `TRACKING_SSE_KEEPALIVE_MS` (20000), `TRACKING_REROUTE_DISTANCE_M` (50) and `TRACKING_BBOX` (`103.62,1.22,104.03,1.47` as `minLon,minLat,maxLon,maxLat`). All are listed in `../env/order-service.env.example`.
