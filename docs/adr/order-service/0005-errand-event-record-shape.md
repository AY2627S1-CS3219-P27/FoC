# Errand event record shape: JSONB payload, projection-issued sequence, idempotency column

## Decision

Each `errand_events` row has:

- `payload JSONB` plus `type` and `schema_version`. Payloads are private to
  order-service and validated per `(type, schema_version)` with AJV before
  insert. They are not added to the shared `contracts/schemas`, which is for
  notices exchanged with other services.
- `from_status` (null on `ErrandCreated`) and `to_status`, both of the
  `errand_status` enum. Every event records the state change it made, rather
  than leaving it to be inferred from `type`.
- `sequence_number`, issued by the `errands` projection row. The transition is
  one statement, `UPDATE errands SET status = …, last_sequence_number =
  last_sequence_number + 1 WHERE id = $1 AND status = $expected RETURNING
  last_sequence_number`. Zero affected rows means the request lost the race
  and no event is inserted. `UNIQUE (errand_id, sequence_number)` is the
  backstop. Callers do not send an expected version; the status guard is the
  concurrency contract.
- A nullable `idempotency_key`, with a partial unique index on `(errand_id,
  idempotency_key)`. Create has no errand yet, so the `errands` row carries a
  unique `(requester_id, idempotency_key)` and the `ErrandCreated` event
  records the key too.

## Rationale

The log is append-only and only read for projection rebuilds, so nothing
queries inside payloads and JSONB avoids a migration per event type.
`schema_version` keeps old events replayable after a payload changes. AJV
matches the JSON Schema tooling credit-service already uses.

A counter on the projection row is bumped inside the same row-locked
`UPDATE` that enforces the transition, so numbers are gap-free per errand
without `MAX(seq)+1` races.

`from_status` and `to_status` are columns, not derived from `type` and not
buried in `payload`. `sequence_number` says in what order events happened, not
what state each one left the errand in, and a projection rebuild needs both.
Deriving the state from a `type → status` map in code would make the meaning of
old rows depend on code that changes. If a transition is later retargeted
(say `CourierCancelled` stops returning to `Open`), a state is renamed, or a
new one is added, a map would silently reinterpret history and a rebuild would
produce a different projection from the one that was live. Stored columns keep
each row true to the rules in force when it was written, and rebuild is "take
the last event's `to_status`". They also make the log queryable ("everything
that entered `Cancelled`") without touching JSONB, and the enum stops a typo
from entering the log.

Postgres cannot drop an enum value that historical rows still use, which is the
correct behaviour for an append-only log. A rename is an `ALTER TYPE … RENAME
VALUE` migration; a removed state stays in the enum as a legacy value, and
`ALLOWED` in `status.ts` simply stops permitting new transitions into it.

Idempotency lives on the event because the key and the transition must
commit together, and it avoids a second table and write. The cost: only
requests that produced an event are replayed. A repeated request that was
rejected is re-evaluated against current state, which is safe because a
rejection changes nothing. A separate `idempotency_keys` table would replay
rejections exactly, but was rejected as more machinery than the requirement
needs. Deduplication of notices between services is separate and uses the
envelope's `eventId`.
