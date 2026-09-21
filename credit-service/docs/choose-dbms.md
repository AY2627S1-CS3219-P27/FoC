# DBMS choice for credit service

## Decision

The credit service shall use **PostgreSQL**.

## Rationale

The service needs to store Credit balances, reservations, and transactions.
These are highly relational and require strong consistency. PostgreSQL provides 
ACID transactions, constraints, and concurrency controls needed to prevent 
invalid balances and conflicting credit operations.

It is also mature, widely supported, and integrates well with NestJS database
libraries.
