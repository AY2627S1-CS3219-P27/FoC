# Supplier validation messages between Order Service and Supplier Service

Status: Accepted (agreed with the order-service owner, 2026-10-18)

## What this is for

When a requester creates an errand, Order Service puts it in the
`Pending-Supplier` state until it knows the chosen supplier exists. This
document proposes how that check works: **Order Service asks by sending a
message through RabbitMQ, and Supplier Service answers with another
message.** It defines the two messages, so both services can be built
against the same format.

The format is written into the shared contracts as JSON Schemas, and both
services validate every message against it (Supplier FR v2 F15.7.7):
`packages/contracts/src/domain-events/events/supplier-validation-requested/v1/`
and `…/supplier-validation-completed/v1/`, registered in `event-registry.ts`.

## Why messages (async) instead of a direct API call

- **It fits Order Service's existing design.** Errands already start in
  `Pending-Supplier` and wait for a supplier-validated step, with a
  `SUPPLIER_VALIDATION_TIMEOUT` cancellation reason
  ([order-service ADR 0007](../order-service/0007-expiry-duration-autocomplete-and-supplier-validation.md)).
- **No service-to-service login is needed.** Supplier Service's API requires
  a user's login token, and the team has not decided how one service logs in
  to another. Over RabbitMQ, each service uses its own broker login instead
  (F13.7).
- **Errands keep being created if Supplier Service is down.** They wait in
  `Pending-Supplier`, and the question is answered when it is back.
- The cost is that the requester does not get an instant "bad supplier"
  error. In practice they pick suppliers from Supplier Service's own list, so
  a bad supplier id is rare.

## Message 1: the question (Order Service → Supplier Service)

Routing key `order.supplier-validation-requested.v1`, sent on the
`foc.events` exchange when an errand enters `Pending-Supplier`.

```json
{
  "eventId": "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60",
  "eventType": "SupplierValidationRequested",
  "timestamp": "2026-10-20T10:00:00Z",
  "publisher": "order-service",
  "payload": {
    "errandId": "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b",
    "supplierId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
  }
}
```

| Payload field | Type | Required | Meaning |
|---|---|---|---|
| `errandId` | UUID | yes | The errand waiting for the check |
| `supplierId` | UUID | yes | The supplier the requester chose |

## Message 2: the answer (Supplier Service → Order Service)

Routing key `supplier.validation-completed.v1`, sent on the `foc.events`
exchange, exactly once per question.

When the supplier exists:

```json
{
  "eventId": "9b2e4f6a-1c3d-4e5f-8a7b-2c4d6e8f0a1b",
  "eventType": "SupplierValidationCompleted",
  "timestamp": "2026-10-20T10:00:01Z",
  "publisher": "supplier-service",
  "payload": {
    "errandId": "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b",
    "supplierId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "outcome": "FOUND",
    "supplier": {
      "status": "Active",
      "version": 3,
      "name": "Cool Spot",
      "displayName": "Cool Spot @ COM2",
      "building": {
        "id": "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
        "shortName": "COM2",
        "canonicalName": "Computing 2"
      },
      "floor": "1",
      "locationDescription": "Next to LT19",
      "coordinates": { "latitude": 1.294, "longitude": 103.7738 }
    }
  }
}
```

When the supplier does not exist:

```json
{
  "eventId": "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
  "eventType": "SupplierValidationCompleted",
  "timestamp": "2026-10-20T10:00:01Z",
  "publisher": "supplier-service",
  "payload": {
    "errandId": "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b",
    "supplierId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "outcome": "NOT_FOUND"
  }
}
```

| Payload field | Type | Required | Meaning |
|---|---|---|---|
| `errandId` | UUID | yes | Copied from the question |
| `supplierId` | UUID | yes | Copied from the question |
| `outcome` | `FOUND` or `NOT_FOUND` | yes | Whether the supplier exists |
| `supplier` | object | only when `FOUND` (absent when `NOT_FOUND`) | The supplier's current details, below |
| `supplier.status` | `Active` or `Inactive` | yes | Whether the supplier is offered for new errands |
| `supplier.version` | integer ≥ 1 | yes | Goes up by 1 on every change; lets Order Service tell which snapshot it has |
| `supplier.name` | text | yes | The supplier's name |
| `supplier.displayName` | text | yes | `"<name> @ <building short name>"` |
| `supplier.building` | `{id, shortName, canonicalName}` | yes | The building it is in |
| `supplier.floor` | text | yes | `B1`–`B9`, `1`–`99` or `M` |
| `supplier.locationDescription` | text | yes | How to find it in the building |
| `supplier.coordinates` | `{latitude, longitude}` | yes | Map position |

The snapshot is what Order Service needs to keep its own copy of the supplier
for the errand (F15.1). Later changes to the supplier don't alter errands
already created (F15.5).

## Rules

- **Supplier Service reports facts; Order Service decides.** An Inactive
  supplier is answered `FOUND` with `status: "Inactive"`. Whether that
  cancels the errand is Order Service's decision (F15.2).
- **Exactly one answer per question.** If the same question arrives again
  (same `eventId`, e.g. after a redelivery), it is not answered a second
  time (F15.7.3, F15.7.4).
- **`NOT_FOUND` only means "does not exist".** If Supplier Service cannot
  read its database, it never answers `NOT_FOUND`. It retries with growing
  delays, up to 5 times, then moves the question to a dead-letter queue
  (F15.7.5).
- **Bad questions are not retried.** A question with missing or unknown
  fields, or one not from `order-service`, goes straight to the dead-letter
  queue and is logged (F15.7.6, F13.7).
- **Both messages use the repo's standard wrapper** (`eventId`, `eventType`,
  `timestamp`, `publisher`, `payload`), and unknown fields are rejected.

## Amendment (2026-11-03): the delivery building

Order Service no longer takes the delivery location as free text; it sends a
building id, and asks Supplier Service (which owns buildings) to check it in
the same round trip (Order Service ADR 0011). The v1 messages changed in
place, in the shared contracts:

- **The question** gains a required `deliveryBuildingId` (UUID). A resend of
  the same question carries the same id; an `eventId` reused with a different
  building is treated as a conflict and dead-lettered, like any reused id.
- **The answer** has three outcomes:
  - `FOUND`: as before, plus `deliveryBuilding` (`id`, `shortName`,
    `canonicalName`).
  - `NOT_FOUND`: the supplier does not exist. It wins when the building is
    unknown too, so the building is only checked for a supplier that exists.
  - `BUILDING_NOT_FOUND`: the supplier exists but the building does not. No
    `supplier` or `deliveryBuilding` is sent.
- **Rollout:** `deliveryBuildingId` and the `FOUND` reply's `deliveryBuilding` are
  temporarily optional in the contract (PR #759), so the two services can adopt
  them independently. Without a building id, Supplier Service answers as before
  (`FOUND`, no building check). The fields become required once both services
  use them.
- A **retired building** is answered like an unknown one: Order Service only
  needs to tell the requester to pick another building.
- As with `NOT_FOUND`, `BUILDING_NOT_FOUND` only ever means "does not exist":
  a database failure is retried, never reported as a missing building (F15.7.5).

## Amendment (2026-11-05): the delivery venue and the map pin

A requester can also pick a room (venue) inside the delivery building, or drop
a map pin instead. Supplier Service owns the venues. The v1 messages changed
in place again, in the shared contracts; the field names are as proposed and
are for the order-service owner to confirm.

- **The question** gains an optional `deliveryVenueId` (UUID), valid only
  together with `deliveryBuildingId`. A question without it hashes and behaves
  exactly as before, so messages in flight at rollout are not treated as
  conflicts. An `eventId` reused with a different venue is a conflict.
- **The answer** gains `VENUE_NOT_FOUND` (no `supplier`, `deliveryBuilding` or
  `deliveryVenue` attached), and `FOUND` carries an optional `deliveryVenue`
  (`id`, `code`, `name` or null, `floor`, `coordinates`) when a venue was
  asked for. Precedence: `NOT_FOUND`, then `BUILDING_NOT_FOUND`, then
  `VENUE_NOT_FOUND`. An unknown, retired or other-building venue is all
  `VENUE_NOT_FOUND`.
- **Map pin without a contract change.** One placeholder building,
  "Other (map pin)", identified by its short name `PIN` (`allowsPin: true` on
  `GET /buildings`), keeps
  `deliveryBuildingId` required. A pin errand sends that building's id and no
  venue id and validates as `FOUND`; a venue id sent with it is
  `VENUE_NOT_FOUND`. The reply carries no pin flag. The pin's coordinates stay
  Order Service's concern.
- Supplier Service refuses to retire the pin building, or to attach venues or
  suppliers to it.
- **Building alone, or pin, never both.** A requester who cannot find their
  venue drops a pin instead, and the pin building replaces the building they
  had chosen: the pin cannot be tied to a building, so no building is kept.
  Validation still accepts a building with no venue even if that building has
  venues; the reply carries no venue count, so that choice is the client's.
- **Venues have no admin endpoint yet.** They come only from the seed file,
  and `VenuesService.retire` has no HTTP caller, so a venue is retired by hand
  today. Admin endpoints to create, update and retire venues are tracked in
  #822 and deferred until time allows.

## Amendment (2026-11-06): building coordinates in the answer

Order Service now gives the courier a coordinate pair for every errand, so a
building-only errand needs a point to navigate to. The v1 answer changed in
place again, in the shared contracts:

- `FOUND`'s `deliveryBuilding` gains a required `coordinates` (`latitude`,
  `longitude`), the building's own point. Supplier Service and Order Service
  change together in one PR, so it is required at once rather than made
  temporarily optional as in PR #759.
- A pin never reaches Supplier Service, so nothing else changes.

## Who does what

| Order Service | Supplier Service |
|---|---|
| Sends the question when an errand enters `Pending-Supplier` | Listens for the question |
| Handles the answer: moves the errand on, or cancels it (e.g. `SUPPLIER_UNAVAILABLE`) | Looks up the supplier and sends exactly one answer |
| Applies its own timeout (`SUPPLIER_VALIDATION_TIMEOUT`) if no answer arrives | Retries when its database is down, then dead-letters |

Both messages' schemas are in `packages/contracts`, so either side can
validate against them with `AccountEventContractValidator`.

## Questions for the order-service owner

1. Is the supplier snapshot enough for what Order Service stores about the
   supplier? Anything to add or drop?
2. Are `FOUND` / `NOT_FOUND` the outcomes you want, and is "Inactive is
   `FOUND` with its status" OK?
3. Who edits `rabbitmq/definitions.json` (a Supplier Service login, and the
   queues for both messages) and `scripts/ci-stack-secrets.sh`?
4. Besides these messages, will Order Service also call
   `GET /suppliers/{id}` directly? That endpoint needs a user's login token,
   and service-to-service login is still undecided.
