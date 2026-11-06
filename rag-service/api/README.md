# RAG Service API collection (Postman)

The help bot as a runnable Postman collection: answers with sources, refusals, denied requests and the rate limit. Nothing needs a frontend.

| File | What |
|---|---|
| `rag-service.postman_collection.json` | The requests, in demo order, each with checks (green ticks) |
| `local.postman_environment.json` | The service URL and the login token |

## Set up

1. Put a real OpenRouter key in `rag-service/secrets/openrouter_api_key.secret`, with a spending limit set on the key.
2. Start the service with its debug port, from the repo root: `docker compose -f compose.yaml -f compose.debug.yaml up -d --build rag-service` (see the service README for first-time setup).
3. In VS Code, open the **Postman** extension, then **Import** both files.
4. Select the environment **FoC RAG Service (local)**.
5. Get a token, and paste it into `token`. Either log in at user-service and copy the `access_token` cookie, or, for a quick local check, run `node rag-service/scripts/sign-eval-token.mjs`, which signs one with user-service's own key. It lasts 1 hour.

## Run it

Run the folders in order, either one request at a time (for the live demo) or with the collection runner.

| Folder | Shows | Needs a real model? |
|---|---|---|
| **1 Answers with sources** | A FAQ question, a support question, and a question worded differently from the documents | Yes |
| **2 Refusals** | An account question, off-topic, and two prompt injection attempts | Yes, except off-topic and the first injection, which the cutoff stops without a chat call |
| **3 Denied requests** | 401 with no token, and 400 for an empty question, one too long, and an extra field | No |
| **4 Rate limit** | 10 quick questions, then a 429 with `Retry-After` | Embeddings only |
| **5 Health** | `GET /health`, no login needed | No |

Each question costs a tiny amount. Folder 4 uses up the limit, so wait a minute before asking again. Re-running the whole collection within a minute will hit the limit early and fail checks in folders 1 and 2.

The command-line equivalent, for a quick rehearsal:

```sh
cd rag-service
npx newman run api/rag-service.postman_collection.json -e api/local.postman_environment.json --env-var token="<token>"
```
