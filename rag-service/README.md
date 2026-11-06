# rag-service

The FoC help chatbot. It answers general questions from the plain-language documents in `docs/support/` and names the section each answer came from. It cannot see anyone's account or change anything.

This is the scaffold: the service starts, connects to its database and answers `GET /health`. Questions arrive in later steps.

## First-time setup

From the repository root:

```sh
cp env/rag-service.env.example env/rag-service.env
cp rag-service/secrets/rag_db_password.secret.example rag-service/secrets/rag_db_password.secret
cp rag-service/secrets/openrouter_api_key.secret.example rag-service/secrets/openrouter_api_key.secret
```

Change the database password if you like. The placeholder OpenRouter key is enough to start the service; asking questions needs a real key. Set a spending limit on any real key in OpenRouter's dashboard.

The service also reads user-service's public key from `user-service/secrets/jwt_public_key.secret`.

## Running

`docker compose up -d --build rag-service` from the repository root. To reach it from your machine, add `-f compose.yaml -f compose.debug.yaml`: the service is on `127.0.0.1:3008` and its database on `127.0.0.1:5442`.

| Setting | Default | Meaning |
|---|---|---|
| `RAG_OPENROUTER_CHAT_MODEL` | `anthropic/claude-haiku-5.5` | The model that writes answers |
| `RAG_OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | The model that turns text into numbers. Changing it means re-indexing. |

The database image is [`pgvector/pgvector:pg18`](https://hub.docker.com/r/pgvector/pgvector), because the plain Postgres image has no pgvector.

## Tests

Run these from `rag-service/`:

```sh
npm test                 # unit
npm run test:e2e         # the app over HTTP, database faked
npm run db:test:up && npm run test:integration && npm run db:test:down   # real pgvector database
npm run lint
```
