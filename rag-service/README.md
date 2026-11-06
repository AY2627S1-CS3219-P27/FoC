# RAG Service

The RAG Service is FoC's help chatbot. It answers general questions from the plain-language documents in `docs/support/` and names the section each answer came from. It cannot see anyone's account or change anything.

Other services don't call it, and it doesn't call them: it only reads user-service's public key, to check login tokens. If it's down, the rest of FoC is unaffected.

## 1. Overview

It's a fixed pipeline rather than an agent: our code always runs the same steps, and the model only writes the answer. Why it's built this way: [ADR 0001](../docs/adr/rag-service/0001-rag-with-pgvector-and-openrouter.md).

```mermaid
flowchart LR
    client["Frontend / Postman"] -- "POST /assistant/questions" --> api
    subgraph rag["rag-service"]
        api["AssistantController<br/>login guard, question rules"] --> svc["AssistantService"]
        svc --> log["ChatLogRepository<br/>rate limit, question log"]
        svc --> search["ChunkSearchService"]
        svc --> client2["OpenRouterClient"]
        idx["IndexingService<br/>startup + index-docs"] --> client2
    end
    docs["docs/support/<br/>(mounted read-only)"] --> idx
    log --> db[("rag-db<br/>PostgreSQL + pgvector")]
    search --> db
    idx --> db
    client2 -- "embeddings, chat" --> or["OpenRouter"]
    user["user-service"] -. "public key file:<br/>checks tokens without calling it" .-> api
```

```mermaid
sequenceDiagram
    autonumber
    actor U as Student
    participant R as rag-service
    participant D as rag-db
    participant O as OpenRouter
    U->>R: POST /assistant/questions (login token)
    R->>R: check token and question
    R->>D: check limit, write pending row
    alt over the limit
        R-->>U: 429 with Retry-After
    else within the limit
        R->>O: embed the question
        R->>D: find the 4 nearest sections
        alt none above the cutoff
            R-->>U: 200, answered false (no chat call)
        else
            R->>O: rules + sections + question
            O-->>R: answer + SOURCES line
            R-->>U: 200, answer and sources
        end
        R->>D: complete the row
    end
```

## 2. Tech stack, compared with the other services

| Concern | RAG Service | Same as | Notes |
|---|---|---|---|
| Framework | NestJS 12, TypeScript, ES modules | The other Nest services | |
| Database | PostgreSQL 18, own container `rag-db` | The other services | **Different image:** `pgvector/pgvector:pg18`, because the plain image has no pgvector |
| Talking to the database | TypeORM, hand-written migrations applied on startup | supplier-service | `synchronize` is always off |
| Config checks at startup | Joi schema | The other Nest services | |
| Request validation and errors | class-validator DTOs, one JSON error format | supplier-service | |
| Login check | The shared `@foc/auth` guard, public key only | The other Nest services | |
| Logs, metrics, traces | The shared `@foc/observability` | The other Nest services | **Addition:** removes login tokens from its request logs |
| Tests and lint | vitest (unit, e2e, integration), oxlint | supplier-service | |
| Docker | Multi-stage Dockerfile built from the repo root, `npm run start:dev` | The other Nest services | |
| Message broker | **None** | | A question is a direct request and reply |
| Outside calls | **OpenRouter**, with `fetch` and timeouts | None | The only service that depends on an outside AI company |

## 3. Running

From the repository root:

```sh
cp env/rag-service.env.example env/rag-service.env
cp rag-service/secrets/rag_db_password.secret.example rag-service/secrets/rag_db_password.secret
cp rag-service/secrets/openrouter_api_key.secret.example rag-service/secrets/openrouter_api_key.secret
```

Change the database password if you like. The placeholder OpenRouter key is enough to start the service; asking questions needs a real key. Set a spending limit on any real key in OpenRouter's dashboard.

The service also reads user-service's public key from `user-service/secrets/jwt_public_key.secret`.

`docker compose up -d --build rag-service` from the repository root. To reach it from your machine, add `-f compose.yaml -f compose.debug.yaml`: the service is on `127.0.0.1:3008` and its database on `127.0.0.1:5442`.

| Setting | Default | Meaning |
|---|---|---|
| `RAG_OPENROUTER_CHAT_MODEL` | `anthropic/claude-haiku-5.5` | The model that writes answers |
| `RAG_OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | The model that turns text into numbers. Changing it means re-indexing. |

The database image is [`pgvector/pgvector:pg18`](https://hub.docker.com/r/pgvector/pgvector), because the plain Postgres image has no pgvector.

## 4. API

`POST /assistant/questions` with `{ "question": "..." }`, 1 to 500 characters. It needs a login token, like every route except `/health`.

```json
{
  "answer": "...",
  "answered": true,
  "sources": [{ "title": "Errands", "section": "Why is my errand stuck in Pending?" }]
}
```

A refusal or "can't find it" is also a 200, with `answered: false` and no sources.

| Error | When |
|---|---|
| 400 `VALIDATION_FAILED` | Bad question |
| 401 `UNAUTHENTICATED` | No valid login |
| 429 `RATE_LIMITED`, `retryAfterSeconds` and a `Retry-After` header | Over the limit |
| 503 `DEPENDENCY_UNAVAILABLE`, `retryable: true` | OpenRouter or the database is down |

How a question is answered:

1. The user's limit is checked and a `chat_log` row written, before any paid call.
2. The question is turned into numbers with the embedding model.
3. The 4 nearest sections are found. Any below `RAG_RELEVANCE_CUTOFF` are dropped.
4. If none are left, the bot says it can't find the answer, **without calling the chat model**.
5. Otherwise the chat model gets fixed rules, the sections and the question, and answers only from those sections.
6. The reply's `SOURCES` line picks which sections to show. The titles come from our database, so a source can't be invented.
7. The row is completed with the outcome, scores, timings and tokens.

The rules are in `src/assistant/prompt-builder.ts`. The bot has no tools and no access to user data, and it can't change anything, so the worst a prompt injection can do is produce an odd answer. Only the rules, sections and question reach the model, never the user's id, email or token.

Request logs have the `Authorization`, `Cookie` and `Set-Cookie` headers removed (`src/common/logging/logger-options.ts`), because they hold login tokens. Question text isn't logged.

Set a spending limit on any real key: the per-user limit doesn't stop someone using several accounts.

## 5. Database

Two tables, in `rag-db`. Migrations are the only way the schema changes.

| Table | Holds |
|---|---|
| `chunks` | One row per section of the help documents: its source, words, embedding (`vector(1536)`) and the model that made it. Rebuilt from the documents on every re-index |
| `chat_log` | One row per accepted question (see [§6](#6-limits-and-the-question-log)) |

There's no vector index: with about 120 rows, comparing every row is instant and exact.

## 6. Limits and the question log

Each user can ask `RAG_RATE_LIMIT_PER_MINUTE` questions (default 10) in any rolling 60 seconds. Every accepted question counts, including ones stopped by the cutoff, because each costs an embedding call. Requests refused with a 400 or 429 don't count.

`chat_log` holds one row per accepted question: the user's id, the question, the outcome, every section retrieved with its score, timings and tokens. Rows are deleted after `RAG_CHAT_LOG_RETENTION_DAYS` (default 30), at startup and once a day. The question text stays in this table and out of the application logs, which go to Loki.

| Outcome | Meaning |
|---|---|
| `pending` | Being answered, or the service stopped midway |
| `answered` | The model answered |
| `no_match` | Nothing was relevant enough, so the model wasn't called |
| `refused` | The model declined, under its rules |
| `error` | OpenRouter failed; the user got a 503 |

To find what the documents couldn't answer:

```sql
SELECT question, outcome, created_at FROM chat_log
WHERE outcome IN ('no_match', 'refused') ORDER BY created_at DESC;
```

To see the slowest answers and the tokens used per day:

```sql
SELECT question, embed_ms + search_ms + generate_ms AS total_ms FROM chat_log
WHERE outcome = 'answered' ORDER BY total_ms DESC LIMIT 10;

SELECT created_at::date AS day, sum(prompt_tokens) AS tokens_in, sum(completion_tokens) AS tokens_out
FROM chat_log GROUP BY day ORDER BY day DESC;
```

## 7. Updating the help documents

The bot answers from an index of `docs/support/`, not from the files directly. After editing a document, do either of these:

- **Restart the service.** On startup it compares the documents with the index and re-indexes if they differ. Checking costs nothing; re-indexing every section costs a tiny fraction of a cent.
- **Re-index without a restart:** `docker compose exec rag-service npm run index-docs`

Until then the bot keeps answering from the old version. If re-indexing fails, for example because OpenRouter is down or a document breaks the format rules, the old index stays in use. Each document needs `title` and `service` in its front matter, and its `##` headings must be unique.

## 8. Evaluation

A fixed set of questions in `eval/questions.json` measures the bot through the real API. Each answerable question lists the sections that hold its answer and the key facts it must contain; the others must be refused (account, off-topic and injection questions). It uses a real key and costs under a cent, so CI never runs it. Rerun it after changing the documents, the prompt or the cutoff.

```sh
docker compose up -d --build rag-service
docker compose exec -e EVAL_TOKEN="$(node rag-service/scripts/sign-eval-token.mjs)" rag-service npm run evaluate
```

It waits out the rate limit, so it takes a few minutes. It prints a report, including what each cutoff value would have done, and exits with an error if a target is missed.

| Measure | Target |
|---|---|
| Answer names the right section | At least 90% |
| Answer contains every key fact | At least 90% |
| Should-refuse questions refused | 100% |
| 95% of questions within | 10 seconds |

**Results** (6 November 2026, `anthropic/claude-haiku-5.5`, 21 answerable and 9 should-refuse questions). The full report, with every answer, is in [`eval/report.md`](eval/report.md).

| Measure | Result | Target |
|---|---|---|
| Right section retrieved in the top 4 | 21/21 (100%) | |
| Answer names the right section | 21/21 (100%) | At least 90% |
| Answer contains every key fact | 21/21 (100%) | At least 90% |
| Should-refuse questions refused | 9/9 (100%) | 100% |
| Answerable questions wrongly refused | 0/21 | |
| Average time / 95% of questions within | 2.4 s / 3.6 s | 10 s |

**The cutoff stays at 0.3.** The lowest score for an answerable question was 0.39, and the injection attempt the cutoff stopped scored about 0.26. At 0.40 and above, real questions start being stopped.

| Cutoff | Answerable questions wrongly stopped | Should-refuse questions stopped with no chat call |
|---|---|---|
| 0.25 | 0 | 3 |
| **0.30** | **0** | **4** |
| 0.35 | 0 | 4 |
| 0.40 | 1 | 5 |
| 0.50 | 2 | 6 |

**How far to trust these numbers:**

- The questions were written by the developer, who had read the documents, so they aren't what real students would type. Real gaps will show up in `chat_log`.
- 30 questions show the bot works, not exactly how accurate it is.
- The key-fact check only looks for wordings, so all 30 answers were also read against the documents, with AI assistance. None contradicted them. One added a small inference: that a closed shop may not be able to fulfil an errand. Service owners should still read the answers about their service in the report.
- It measures agreement with the documents. A wrong document gives a wrong answer that still passes, which is why service owners read theirs.
- The figure is for one run, and answers vary slightly. An earlier run marked a correct answer as failing because the fact check wanted "unlock" and the answer said "unlocks", so that wording was added. Rerun it after changing the documents, prompt or model.

## 9. Trying it with Postman

See [`api/README.md`](api/README.md).

## 10. Known limits

- Each question stands alone, so there are no follow-up questions.
- It gives general guidance only and can't look up anyone's account, errands or requests.
- Refusing account questions depends on the model following its rules, because they match the documents closely enough to pass the cutoff.
- Answers vary slightly between runs.
- After a document changes, the bot uses the old version until a restart or `npm run index-docs`.
- The rate limit is per account, so the spending limit on the key is the real backstop.
- The chat model's own settings can't be tuned further: its OpenRouter listing doesn't show temperature among the settings it accepts.

## 11. Testing

Run these from `rag-service/`:

```sh
npm test                 # unit
npm run test:e2e         # the app over HTTP, database faked
npm run db:test:up && npm run test:integration && npm run db:test:down   # real pgvector database
npm run lint
```
