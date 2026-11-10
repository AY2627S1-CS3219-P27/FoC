# order-service

Errand lifecycle, state model and expiry. See `AGENTS.md` and `ARCHITECTURE.md`.

## Routes (`/v1/errands`, JWT required)

| Route | Role | Purpose |
|---|---|---|
| `GET /` | Courier | Browse open errands (`pickupBuilding`, `deliveryBuilding`, `minCredits`, `sort`, `limit`, `offset`) |
| `GET /mine` | Requester or Courier | The caller's errands as requester or courier (`role`, `status`, `limit`, `offset`) |
| `GET /:id` | Requester or Courier | One errand; 404 unless a party or the errand is open and unexpired |
| `POST /` | Requester | Create. `deliveryBuildingId` plus at most one of `deliveryVenueId` or `deliveryPin { latitude, longitude }` (both: 400; a pin outside the campus boundary: 400). `deliveryDetail` is required unless a venue is given |
| `PATCH /:id` | Requester | Edit an `Open` errand (F2, ADR 0013): any create field except `deliveryVenueId` and `deliveryPin`. A new building drops any venue or pin, and needs a `deliveryDetail` if none is stored. `supplierId` / `deliveryBuildingId` are re-checked by supplier-service first, `rewardCredits` goes through credit, the rest change at once. Send those three only to change them; a reward and a supplier change together is 422 `ONE_PENDING_CHANGE`. 409 `NOT_EDITABLE` once past `Open`; 422 `EXPIRY_IN_PAST` if the new duration has already run out from when the errand opened |
| `POST /:id/accept`, `pickup`, `deliver`, `withdraw` | Courier | Courier actions |
| `POST /:id/confirm`, `incomplete`, `adjust`, `cancel` | Requester | Requester actions |
| `POST /:id/report` | Requester or assigned Courier | File one immutable text report (max 2,000 characters) on an `Incomplete` errand. 201 `{ filed: true }`; 404 for a non-party; 409 if not `Incomplete`, already reported, or settlement was requested. No attachments yet |

Errand views carry `deliveryLocation` (building short name), `deliveryDetail`, `deliveryVenue` (label), `deliveryLatitude` and `deliveryLongitude`; the last three are null until supplier validation (ADR 0012).

On a `Resolved` errand, `GET /mine` and `GET /:id` add `settlementAmount` (the courier's share) and `settlementNote` for the two parties (and admins, on the admin routes). Never on the open list, never for other users.

On an `Incomplete` errand (including `Settling-Credit`), `GET /mine` and `GET /:id` add `hasReported` (the caller's own report; never the other side's) and `canReport` (false once reported or settlement was requested, even after a rejection) for the two parties, so an app can hide a report form that would 409.

## Admin routes (`/v1/admin`, JWT with `isAdmin`)

| Route | Purpose |
|---|---|
| `GET /users/:userId/errands` | A user's errands as requester or courier, with the internal sub-state (`role`, `status`, `limit`, `offset`) |
| `GET /disputes` | Dispute queue: `Incomplete` errands (including in-flight `Settling-Credit`), longest-disputed first, with which reports exist (`limit`, `offset`) |
| `GET /disputes/:errandId` | One dispute: errand, both reports, event history, latest settlement rejection. 404 when not in dispute |
| `POST /disputes/:errandId/resolve` | Settle with `{ settlementAmount, note }`: 400 invalid, 409 not `Incomplete` or lost the race, 429 after 3 credit rejections in an hour |
