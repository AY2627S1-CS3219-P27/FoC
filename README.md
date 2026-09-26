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

Run the whole project by using docker compose:

```sh
docker compose up --watch
```

The watch flag allows for your changes to be updated in the image.

### First-time set-up

The project requires several environment variables, explained in each module's
`.env.example` file (copy it to `.env` in the same folder). In addition, there are some `.secret` files that should be
created in order to set-up passwords and authentication. View them in the
compose files.

### RabbitMQ set-up

Notably, RabbitMQ requires a password hash in its `definitions.json` for setup.
There already is a password hash defined in them - these should directly
correspond with the `rabbitmq_password.secret` files that modules have. You may
either match the password with the one in the hash (ask a dev), or create your
own secret and overwrite the one in `definitions.json`. You may create a hash by
running the following, assuming `rabbitmq_temp` is a running rabbitmq container:

```sh
docker exec rabbitmq_temp rabbitmqctl hash_password {YOUR PASSWORD HERE}
```
