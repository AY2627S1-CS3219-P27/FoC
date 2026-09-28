# Supplier Service API collection (Postman)

The D2 demo as a runnable Postman collection: query patterns, denied requests, and CRUD through the API alone, with no UI.

| File | What |
|---|---|
| `supplier-service.postman_collection.json` | The requests, in demo order, each with checks (green ticks) |
| `local.postman_environment.json` | Service URLs, the demo accounts, and the ids and tokens the requests save for each other |

## Set up

1. Start the stack from the repo root: `docker compose up` (see the main README for secrets and `.env` files). user-service must be running for the logins.
2. In VS Code, open the **Postman** extension, then **Import** both files.
3. Select the environment **FoC Supplier Service (local)** and fill in `basicEmail`, `basicPassword`, `adminEmail` and `adminPassword` (see *Demo accounts*). Don't commit real passwords: they stay in your local Postman.

## Run it

Run the folders in order, either one request at a time (for the live demo) or with the collection runner.

| Folder | Shows | D2 |
|---|---|---|
| **0 Setup (log in)** | Logs in at user-service as each user and saves their tokens (`basicToken`, `adminToken`) | point 4 |
| **1 Query patterns** | List with pagination, search by name, by building (location), by category, combined filters with sorting, next page, one supplier (with its version as ETag), 404, 400 for bad parameters | point 2 |
| **2 Denied requests** | No login → 401; a basic user creating, editing or deactivating a supplier, or creating a category → 403, nothing changed | points 2, 4 |
| **3 CRUD as admin** | Create (201) → duplicate (409) → every problem in one 400 → read → edit without If-Match (428) → edit (version 2) → out-of-date edit (409 with the current version) → deactivate, D2's "delete" (version 3) → deactivate again (409) → gone from the Active list → still readable, tagged Inactive | point 3 |

**How the two users coexist:** each login saves that user's token, and every Supplier Service request sends one of them as `Authorization: Bearer`. Those requests have Postman's cookie jar switched off, because the jar holds only the last login's cookie. The same request can therefore run as the basic user or the admin side by side.

**Re-running:** folder 3 creates a new supplier named `Demo Stall <timestamp>` on every run, so it can be run again and again. Each run leaves one Inactive demo supplier behind.

**Without user-service:** paste valid tokens into `basicToken` and `adminToken` by hand and skip folder 0.

## Demo accounts

- **Basic user:** register through user-service (request an email code, read it in Papercut at `http://localhost:3050`, validate it, register), then use that email and password.
- **Admin:** a user-service account with `isAdmin: true`. The bootstrap admin is created locked, so this depends on user-service's unlock or reset flow.

## Command line

The same run, without the Postman app, using Postman's CLI runner:

```sh
npx newman run supplier-service.postman_collection.json -e local.postman_environment.json \
  --env-var basicEmail=… --env-var basicPassword=… --env-var adminEmail=… --env-var adminPassword=…
```

## Keeping it in sync

The files here are the source of truth. After changing the collection in Postman, **export it again over these files** (collection v2.1), so the copy in git never goes stale.
