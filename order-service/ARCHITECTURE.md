# order-service architecture

Diagrams are Mermaid (render on GitHub / VS Code). Decisions behind them: ADRs [0001](../docs/adr/order-service/0001-hand-rolled-event-sourcing-on-postgres.md)–[0005](../docs/adr/order-service/0005-errand-event-record-shape.md). Terms: [`CONTEXT.md`](./CONTEXT.md).

## 1. Components

```mermaid
flowchart LR
  Client([Requester / Courier / Admin app])
  User[user-service]
  Supplier[supplier-service]
  Credit[credit-service]

  subgraph OS[order-service NestJS]
    API[HTTP controllers<br/>create, edit, cancel, list, accept,<br/>pickup, deliver, confirm, role-check]
    Life[Lifecycle module<br/>state machine + transition function]
    Read[Read side<br/>list / filter / sort, sub-state to Pending]
    Consumers[Notice consumers<br/>supplier + credit replies]
    Pub[Notice publisher]
    Sweeps[Sweeps<br/>expiry, supplier retry, auto-complete]
  end

  subgraph PG[PostgreSQL]
    Errands[errands<br/>projection, last_sequence_number]
    Events[errand_events<br/>append-only log]
    Locks[advisory locks]
  end

  MQ{{RabbitMQ foc.events}}

  Client --> API
  User -- "role check / block (F10)" --> API
  Supplier -- "hard-delete usage query (F5.3.1)" --> API
  API --> Life
  API --> Read
  Read --> Errands
  Life -->|"one transaction: conditional UPDATE + INSERT"| Errands
  Life --> Events
  Sweeps --> Locks
  Sweeps --> Life
  Life --> Pub
  Pub --> MQ
  MQ --> Consumers
  Consumers --> Life
  MQ <--> Supplier
  MQ <--> Credit
```

Only the Lifecycle module writes. Every write, from a request, a notice reply or a sweep, goes through the same transition function.

## 2. State model (final, F9.4)

Final state transitions (F9.4). Terminal states: Completed, Cancelled, Incomplete. There is no Expired state.
1) Pending Supplier -> Pending-Credit (supplier validation  confirmed)	
2) Pending Supplier -> Cancelled (supplier validation failed)	
3) Pending Credit -> Open (credit reservation confirmed)	
4) Pending Credit -> Cancelled (credit reservation failed)	
5) Open -> Accepted  (courier accepts the errand)	
6) Open -> Cancelled (see F, requester cancels before acceptance)	
7) Open -> Cancelled with reason ERRAND_EXPIRED (see F, expiry time reached)	
8) Accepted -> Picked Up (see F, courier marks picked up)	
9) Accepted -> Open (see F, courier cancels after accepting, before pickup)	
10) Accepted -> Cancelled (see F requester cancels after acceptance, before pickup, if permitted)	
11) Picked Up -> Delivered (see F, courier marks delivered)	
12) Picked Up -> Cancelled	
13) Delivered -> Completed (requester confirms delivery, or auto-complete after 24h)	
14) Delivered -> Incomplete (requestor marks delivery as incomplete)


```mermaid
stateDiagram-v2
  [*] --> PendingSupplier: create
  state Pending {
    PendingSupplier --> PendingCredit: supplier validation confirmed
    PendingCredit
  }
  PendingSupplier --> Cancelled: supplier validation failed (SUPPLIER_UNAVAILABLE / VALIDATION_TIMEOUT)
  PendingCredit --> Open: credit reservation confirmed
  PendingCredit --> Cancelled: reservation failed / timed out
  Open --> Accepted: courier accepts
  Open --> Cancelled: requester cancels
  Open --> Cancelled: expiry deadline reached (ERRAND_EXPIRED)
  Accepted --> PickedUp: courier marks picked up
  Accepted --> Open: courier cancels
  Accepted --> Cancelled: requester cancels, if permitted
  PickedUp --> Delivered: courier marks delivered
  PickedUp --> Cancelled: PICKUP_TIME_EXCEEDED
  Delivered --> Completed: requester confirms / auto after 24h
  Delivered --> Incomplete: requester marks incomplete
  Completed --> [*]
  Cancelled --> [*]
  Incomplete --> [*]
```

## 3. The write path (all transitions)

```mermaid
sequenceDiagram
  participant C as Caller (request, reply, or sweep)
  participant L as Lifecycle
  participant DB as PostgreSQL
  C->>L: transition(errandId, expectedStatus, newStatus, actor, payload, idempotencyKey?)
  L->>DB: BEGIN
  L->>DB: UPDATE errands SET status, last_sequence_number+1<br/>WHERE id AND status = expected RETURNING seq
  alt 0 rows affected
    L->>DB: ROLLBACK
    L-->>C: conflict, current state returned
  else 1 row affected
    L->>DB: INSERT errand_events (seq, type, from, to, actor, payload JSONB, key)
    L->>DB: COMMIT
    L-->>C: success
    L--)C: publish notice after commit, if any
  end
```

Concurrent accepts, late credit replies and sweep ticks all lose safely at the `WHERE status = expected` check. No Redis or RabbitMQ is involved in the race.

## 4. Create errand (the longest flow)

```mermaid
sequenceDiagram
  participant R as Requester
  participant O as order-service
  participant S as supplier-service
  participant K as credit-service
  R->>O: POST /errands (Idempotency-Key)
  O->>O: validate (F1.1), not role-blocked
  O-->>R: 201 errand, status Pending
  Note over O: stored as Pending-Supplier
  O-)S: supplier validation request
  S--)O: success (Active) / failure
  O->>O: Pending-Supplier to Pending-Credit
  O-)K: CreditReservation (once)
  K--)O: CreditReservationSuccess / Rejected
  O->>O: to Open (deadline = now + duration) or Cancelled
```

Creation never blocks on the supplier or credit outcome (F1.4.2). If Supplier Service is unreachable the errand stays in `Pending-Supplier` and the retry sweep picks it up.

