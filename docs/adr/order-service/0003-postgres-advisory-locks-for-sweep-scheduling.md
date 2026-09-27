# PostgreSQL advisory locks for scheduled sweeps

## Decision

Each of order-service's scheduled sweeps (expiry, supplier-validation retry,
pickup/delivery auto-completion) takes a PostgreSQL advisory lock
(`pg_try_advisory_lock`) at the start of its tick and skips the tick if it
can't acquire it, rather than using a Redis-based lock or assuming a single
replica.

## Rationale

The backlog requires each sweep to run on exactly one instance at a time
regardless of replica count, and horizontal scaling of order-service is a
real possibility going forward. `pg_try_advisory_lock` is non-blocking (an
instance that loses the race just skips the tick) and needs no new
infrastructure — it uses the database connection the service already holds.
It's also self-healing: the lock is tied to the connection/session, so a
crashed instance can't leave it stuck.

A Redis lock was considered and rejected: it would add an infrastructure
dependency order-service doesn't otherwise need, plus TTL tuning to avoid a
lock either expiring mid-sweep or being held forever by a crashed instance.
Assuming a single replica was also rejected — it fails silently (duplicate
sweeps, duplicate notices) the moment the service is scaled, rather than
failing loudly or simply working.
