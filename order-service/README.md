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
