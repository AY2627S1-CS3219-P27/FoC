# Errand event record shape: JSONB payload, projection-issued sequence, idempotency key table

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
- Idempotency is not stored on the event. An `idempotency_keys` table holds
  `(errand_id, key, fingerprint, outcome JSONB, created_at)` with primary key
  `(errand_id, key)`. `fingerprint` is the request's `expected`, `to` and
  actor; `outcome` is the exact result returned the first time, whether it
  was a transition or a rejection. A keyed transition claims the key
  (`INSERT … ON CONFLICT DO NOTHING`) at the start of its transaction, runs,
  and stores its outcome before commit. A repeated key returns the stored
  outcome unchanged; the same key with a different fingerprint is refused as
  reuse. Create has no errand yet, so its key is scoped to the requester
  instead; the exact shape is settled when create is built.

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

Idempotency (F9.10.1) requires a repeated key to return the original
outcome, so a key has exactly one outcome for its lifetime. That includes
rejections, which write no event and so have nowhere to keep a key on the log.
Hence a separate table, written in the same transaction as the transition.

Re-evaluating rejected requests against current state was considered
(originally chosen here, keeping the key on the event and avoiding a second
write). It is safe for the invariants, since the status guard alone gives
single assignment, but it lets a stale duplicate succeed: a courier rejected
because another courier held the errand, then a redelivered copy of that
request arrives after the other courier withdrew, and the first courier is
assigned an errand they were told they did not get. The `Accepted` and `Open`
loop is the only place state becomes possible again, but strict replay removes
the ambiguity between a deliberate retry and a stale duplicate. A client that
wants a genuine second attempt sends a new key.

The costs: one extra write per keyed request, and the table grows, so keys
need a retention policy (expire after a fixed window). Claiming the key first
also serialises concurrent same-key requests on the primary key, which replaces
the earlier "recheck after a lost `UPDATE`" replay path. F9.10 (repeat by the
same user of an already-applied transition, no key) is a separate rule and is
not covered by this table. Deduplication of notices between services is also
separate and uses the envelope's `eventId`.
