# Environment files

One `.env` per service, plus a `shared.env` for config every service needs
(global settings, Redis, the RabbitMQ connection). Root `compose.yaml` loads
`shared.env` + the matching `<service>.env` for each included service.

First-time setup:

```sh
for f in env/*.env.example; do cp "$f" "${f%.example}"; done
```

Real `.env` files are git-ignored — never commit them. Passwords/keys are
Docker secrets and stay in each service's own `secrets/` folder, not here.

`credit-service/.env.example` is separate and stays inside `credit-service/`:
it configures that service's test/recovery-only Compose profiles, which run
standalone and are never part of the root stack.
