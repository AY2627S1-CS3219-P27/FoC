# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on campus,
and other students can fulfil (and deliver) those requests. The platform runs on
a closed credit economy — credits cannot be bought, withdrawn, or exchanged for
money, and only circulate within the platform.

---

## Team Members

| Name      | Role           |
| --------- | -------------- |
| Arjun | Implemented User Service, Email Service, and Notification Service. Set up Observability. |
| Anthony| Implemented Supplier Service, and the RAG Chatbot Service.|
| Zhen Ting| Implemented Order Service, as well as Order Service Enhancements|
| Jiong Rui | Implemented Order Service, and did Cloud Deployment.|
| Thaddaeus | Implemented Credit Service and Real Time Chat.|

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`, `comms-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── comms-service/
├── email-service/
├── frontend/
└── README.md
```

- Any **nice-to-have (N2H)** feature that warrants its own service should be
  added as an **additional folder** at the same level, following the same
  per-service structure.
- Files for agentic coding tools (e.g. agent configs, prompts, skills) may be
  added as needed, but must still **respect the one-service-per-folder
  skeleton** for core implementation.

---

## Running via Docker Compose

Everything runs from the repository root. Prerequisites: Docker with Compose.
Node is only needed to run a service's tests or tooling outside Docker.

### First-time set-up

1. **Env files.** One `shared.env` plus one `<service>.env` per service in
   `env/` (see `env/README.md`):

   ```sh
   for f in env/*.env.example; do cp "$f" "${f%.example}"; done
   ```

2. **Secrets.** Each service keeps git-ignored `*.secret` files in its own
   `secrets/` folder (DB password, RabbitMQ password, and for `user-service`
   the JWT keypair and server secret). Where a `*.secret.example` exists, copy
   it and replace the value; otherwise create the file named in the service's
   `compose.yml`. Every service reads `user-service/secrets/jwt_public_key.secret`.
   `scripts/ci-stack-secrets.sh` shows a complete set, but it overwrites
   `rabbitmq/definitions.json`, so only run it on a throwaway checkout.
3. **RabbitMQ passwords.** Each service's RabbitMQ password must match its hash
   in `rabbitmq/definitions.json`; see [RabbitMQ set-up](#rabbitmq-set-up).
4. **Create the Credit and Communication Service database schemas.** Neither
   service migrates on startup: Credit's consumers and outbox relay fail on
   an empty schema, and Communication Service's TypeORM `synchronize` is
   disabled in every environment.

   ```sh
   docker compose up -d --wait rabbitmq credit-db
   docker compose build credit-service
   docker compose run --rm credit-service npm run migration:run

   docker compose up -d --wait rabbitmq comms-db
   docker compose build comms-service
   docker compose run --rm comms-service npm run migration:run
   ```

   Order and Supplier Services apply their own migrations on startup
   (`ORDER_SERVICE_DB_MIGRATIONS_RUN` / `SUPPLIER_DB_MIGRATIONS_RUN`, default
   `true`). Supplier also seeds suppliers from `data/csv` on first start.
5. **Start the stack:**

   ```sh
   docker compose up --watch
   ```

   `--watch` syncs source changes into the dev containers. The browser only
   reaches the frontend at <http://localhost:3001>; see the next section for
   direct service access.

### Day to day

| Situation | What to run |
| --- | --- |
| Start again after a clean shutdown | `docker compose up --watch` |
| Edited source in a service | Nothing, if `--watch` is running. |
| Changed `package.json` / `package-lock.json`, a Dockerfile, or `packages/*` | `docker compose up --build --watch` (or `docker compose build <service>` first) |
| Edited `env/*.env` or a `*.secret` | `docker compose up -d --force-recreate <service>` |
| Pulled a new **Credit** migration | `docker compose run --rm credit-service npm run migration:run`, then restart `credit-service` |
| Pulled a new **Communication Service** migration | `docker compose run --rm comms-service npm run migration:run`, then restart `comms-service` |
| Pulled a new **Order** migration | Restart `order-service`; it migrates on startup. To run it by hand: `docker compose run --rm --no-deps order-service npm run db:migrate` |
| Pulled a new **Supplier** migration | Restart `supplier-service`; it migrates on startup |
| Changed `order-service/src/db/schema.ts` | `cd order-service && npm run db:generate -- --name=<slug>` and commit the SQL and `drizzle/meta`. Existing rows need a default for any new `NOT NULL` column. |
| Changed an entity in Credit or Supplier | `npm run migration:generate -- src/database/migrations/<name>` in that service; `synchronize` stays off |
| Changed `rabbitmq/definitions.json` | The broker only imports it on a fresh volume: `docker compose down rabbitmq && docker volume rm <project>_rabbitmq_data`, then `up` |
| Wipe all data and start over | `docker compose down -v`, then repeat step 4 |
| Run the pinned, versioned images | `./scripts/build-images.sh up -d --wait` (plain `docker compose` uses the `dev` tag) |
| Debug a service or DB directly (Swagger, psql) | `docker compose -f compose.yaml -f compose.debug.yaml up -d --wait` |

Service-specific workflows and verification commands are in each service's
README, e.g. [Credit Service](credit-service/README.md#run-with-docker-compose)
or [Communication Service](comms-service/README.md#local-commands).

### RabbitMQ set-up

Notably, RabbitMQ requires a password hash in its `definitions.json` for setup.
There already is a password hash defined in them - these should directly
correspond with the `rabbitmq_<service>_password.secret` files that modules have (e.g. `rabbitmq_user_password.secret`, `rabbitmq_email_password.secret`). You may
either match the password with the one in the hash (ask a dev), or create your
own secret and overwrite the one in `definitions.json`. You may create a hash by
running the following, assuming `rabbitmq_temp` is a running rabbitmq container:

```sh
docker exec rabbitmq_temp rabbitmqctl hash_password {YOUR PASSWORD HERE}
```

Replace only the matching service user's hash. Broker definitions, including
password hashes, remain sensitive configuration. They also seed critical
durable ingress queues and bindings before their consumers start; services
reassert their matching service-owned topology at runtime. Credit Service uses
the root `/foc` broker in normal development; its local RabbitMQ containers are
reserved for isolated messaging and recovery tests.

## AI Declaration

Tools: Copilot, Opencode, Codex, Claude Code, Claude Design
Models: GLM (SoClaas), Big Pickle, GPT 5.6 Sol, GPT 6.1 Sol, Sonnet 5.5

All code was reviewed & approved by a separate contributor than the implementer.

### Usage Scenarios

Used for:
- Maintaining ADRs based on human decisions
- Maintaining an AGENTS.md for repository context
- Agentic coding driven by human decisions
- Designing frontend, with tweaks made.


### Skills

The apple-design skill was used in designing the frontend - see `.github/skills/apple-design/SKILL.md`.

Other than that, other tool in-built skills (such as code-review) were used.
