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
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── <n2h-service>/
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

After the service databases have been initialized, run the whole project with
Docker Compose:

```sh
docker compose up --watch
```

The watch flag synchronizes supported source changes into the development
containers. A fresh checkout requires the initialization steps below first.

### First-time set-up

Environment variables live in the root `env/` folder: one `shared.env` plus
one `<service>.env` per service. Create them all with:

```sh
for f in env/*.env.example; do cp "$f" "${f%.example}"; done
```

`compose.yaml` loads `shared.env` and the matching service file for each
included service; see `env/README.md`. In addition, there are some `.secret`
files that should be created in order to set-up passwords and authentication.
View them in the compose files.

Credit Service deliberately disables TypeORM schema synchronization and does
not run migrations during application startup. Initialize its database before
starting the complete stack so its consumer and outbox relay cannot access an
empty schema:

```sh
docker compose up -d --wait rabbitmq credit-db
docker compose build credit-service
docker compose run --rm credit-service npm run migration:run
docker compose up --watch
```

Run the same Credit migration command after pulling a new committed migration,
before starting the updated Credit Service. TypeORM skips migrations that have
already been applied. See the [Credit Service setup](credit-service/README.md#run-with-docker-compose)
for its service-specific workflow and verification commands.

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
