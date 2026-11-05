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
| `POST /:id/report` | Requester or assigned Courier | File one immutable text report (max 2,000 characters) on an `Incomplete` errand. 201 `{ filed: true }`; 404 for a non-party; 409 if not `Incomplete`, already reported, or settlement was requested. No attachments yet |

On a `Resolved` errand, `GET /mine` and `GET /:id` add `settlementAmount` (the courier's share) and `settlementNote` for the two parties (and admins, on the admin routes). Never on the open list, never for other users.

## Admin routes (`/v1/admin`, JWT with `isAdmin`)

| Route | Purpose |
|---|---|
| `GET /users/:userId/errands` | A user's errands as requester or courier, with the internal sub-state (`role`, `status`, `limit`, `offset`) |
| `GET /disputes` | Dispute queue: `Incomplete` errands (including in-flight `Settling-Credit`), longest-disputed first, with which reports exist (`limit`, `offset`) |
| `GET /disputes/:errandId` | One dispute: errand, both reports, event history, latest settlement rejection. 404 when not in dispute |
| `POST /disputes/:errandId/resolve` | Settle with `{ settlementAmount, note }`: 400 invalid, 409 not `Incomplete` or lost the race, 429 after 3 credit rejections in an hour |
