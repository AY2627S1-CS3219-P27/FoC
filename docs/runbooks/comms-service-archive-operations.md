# Communication Service archive operations

This runbook covers grace-deadline reconciliation, the leased per-replica
archive worker, and participant-only immutable archive reads. It does not
authorize manual snapshot edits, forcing archival ahead of the committed
deadline, manual lease/claim manipulation, or direct database mutation of
`chats`, `messages`, or `chat_archives` rows.

## Signals and safe labels

Prometheus scrapes `/metrics`. Communication Service emits:

| Metric                                      | Labels    | Meaning                                                                      |
| -------------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| `foc_comms_archive_claims_total`             | `outcome` | Claim attempts by a replica's archive worker: claimed, reclaimed, or none available. |
| `foc_comms_archive_claims_in_flight`         | none      | Gauge of claims currently held by this replica's worker.                     |
| `foc_comms_archive_operations_total`         | `outcome` | Completed archive transactions: archived or failed.                          |
| `foc_comms_archive_claim_duration_seconds`   | `outcome` | Latency from claim to release, successful or failed.                         |
| `foc_comms_archive_shutdown_total`           | `outcome` | Drain result at shutdown: drained or timed out.                              |
| `foc_comms_socket_notifications_total`       | `event`, `outcome` | Best-effort `chat:closing`/`chat:archived` emission outcomes.         |

Labels are bounded enums only. Chat IDs, message IDs, archive IDs, claim
tokens, and participant IDs must never become metric labels.

Investigate a claim count that stays in flight past `ARCHIVE_CLAIM_TTL_MS`
(default 60 seconds), a rising share of `failed`/non-`archived` outcomes, or
an archive-worker shutdown that reports `timed_out` outside the configured
`ARCHIVE_SHUTDOWN_DRAIN_TIMEOUT_MS` (default 10 seconds).

## Grace deadline recovery

Delivery and cancellation grace deadlines are computed and shortened only by
the service's own transactional handlers: a later terminal fact can shorten
a deadline, never extend it, and terminal evidence received before
acceptance reconciles automatically once the chat is created. There is no
manual deadline-correction path. If a deadline looks wrong, verify it with a
read-only query first:

```sql
SELECT id, state, closes_at, close_reason, updated_at
FROM chats
WHERE id = '<chat-id>';
```

Do not update `chats` directly to change a deadline. If the committed value
is genuinely wrong, the cause is in the upstream Order Service lifecycle
notice, not in Communication Service state — investigate the originating
notice before considering any correction.

## Inspecting and recovering an abandoned archive claim

Every replica's archive worker polls for due chats, claims one with a
PostgreSQL-backed lease of `ARCHIVE_CLAIM_TTL_MS`, and releases the claim on
completion or failure. A claim only becomes "abandoned" if its holding
replica crashes or is killed mid-operation.

1. Confirm the claim's lease has actually expired (its
   `archive_claim_expires_at` is in the past) before treating it as
   abandoned rather than merely in progress:

   ```sql
   SELECT id, state, archive_claim_token, archive_claim_expires_at
   FROM chats
   WHERE archive_claim_token IS NOT NULL;
   ```

2. Do not clear `archive_claim_token` or edit `archive_claim_expires_at` by hand.
   Lease expiry alone makes an abandoned claim eligible for another
   replica's next poll cycle — no operator action is required for the claim
   itself.
3. If a replica is visibly stuck (not polling, not progressing claims),
   restart that replica. Restarting is the only operator action; it does not
   require touching chat or archive rows.
4. After recovery, confirm `foc_comms_archive_claims_in_flight` returns to
   the expected count and `foc_comms_archive_operations_total{outcome="archived"}`
   resumes advancing for the previously stuck chat.

## Archive evidence for manual demonstration

Use read-only queries to confirm archival completed, without ever recording
message content, participant payloads, or snapshot bodies in an incident
record or demonstration log:

```sql
SELECT c.id, c.state, a.archived_at
FROM chats c
JOIN chat_archives a ON a.chat_id = c.id
WHERE c.state = 'ARCHIVED'
ORDER BY a.archived_at DESC
LIMIT 20;

SELECT id AS archive_id, chat_id, schema_version, archived_at,
       jsonb_array_length(snapshot -> 'messages') AS message_count
FROM chat_archives
ORDER BY archived_at DESC
LIMIT 20;
```

Confirm `schema_version = 1`, a plausible `message_count`, and that the
`chats` row referencing the same chat is `ARCHIVED` with no remaining
`messages` rows:

```sql
SELECT count(*) FROM messages WHERE chat_id = '<chat-id>';
```

Record only counts, timestamps, IDs, and status/outcome labels as evidence.
Never paste `snapshot` contents, cookies, tokens, or access-token values into
an incident record, screenshot, or demonstration artifact.

## Rollout and rollback

1. Deploy Communication Service only after its migration has been applied
   explicitly (see `comms-service/README.md` §"Compose and secrets"); the
   archive worker starts on every replica alongside the HTTP and socket
   servers, using the already-configured `ARCHIVE_*` variables.
2. Confirm `/health/ready` reports healthy and `foc_comms_archive_claims_in_flight`
   is reporting (zero is a valid steady state when no chat is due).
3. Observe `foc_comms_archive_operations_total` and
   `foc_comms_socket_notifications_total{event="archived"}` advance together
   as chats reach their grace deadline during the soak period.
4. To roll back, stop new archive claim cycles by stopping Communication
   Service gracefully: shutdown stops polling for new claims and drains the
   current operation for at most `ARCHIVE_SHUTDOWN_DRAIN_TIMEOUT_MS` before
   forced termination. Any claim abandoned by a forced stop recovers through
   normal lease expiry once the service restarts — no manual cleanup.
5. Do not revert a populated migration, delete `chat_archives` rows, restore
   deleted `messages` rows, or reopen an archived chat as part of ordinary
   rollback. Migration reversal requires explicit approval and proof that no
   retained archive evidence is required.
