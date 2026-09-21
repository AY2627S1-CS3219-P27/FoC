# DBMS choice for user service

## Decision

The user service shall use **Redis** and **PostgreSQL**

## Rationale

### PostgreSQL

The service needs to store user accounts, password hashes, profile info, roles,
etc. These are highly relational in nature. We must additionally enforce
uniqueness and durability, making NoSQL and in-memory DBMSes less-suitable.

Among other relational DBMSes, PostgreSQL is chosen as it works well at scale,
handles concurrency (better than MySQL), and is an industry choice.

### Redis

Redis was chosen for faster operations with OTPs/Registration token flows,
especially when verifying. Additionally, due to their ephemeral nature, Redis
can easily expire and remove the items automatically so that developers don't
have to worry about stale tokens/OTPs.
