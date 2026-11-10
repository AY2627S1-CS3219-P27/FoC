# A RAG help bot with pgvector and OpenRouter

Status: Accepted

## Context

FoC has several services and roles, and a student cannot easily tell why an errand is stuck, how credits are held, or why a supplier request was denied. The answers exist only in READMEs and ADRs written for developers. We want a chat box that answers FAQ and support questions from curated documents, names its sources, and says so when the documents do not cover a question.

The bot must not make things up, must not see user data, and must have a predictable cost.

## Decision

`rag-service` is its own NestJS service with its own PostgreSQL database. It answers with retrieval-augmented generation (RAG): it finds the help sections closest in meaning to a question, then asks a language model to answer using only those.

- **Documents:** plain-language Markdown in `docs/support/`, one topic per question-style heading.
- **Search:** embeddings stored in PostgreSQL with the `pgvector` extension, compared by cosine distance.
- **Models:** both called through OpenRouter, using fixed model names: `openai/text-embedding-3-small` and `anthropic/claude-haiku-5.5`.
- **Flow:** a fixed pipeline. Our code always runs the same steps, and the model only writes the answer.

## Rationale

### A fixed pipeline, not an agent

An agent is a model in a loop that chooses its own actions with tools. This bot has no tools and makes no decisions about what to do next, so it is a RAG chatbot, not an agent. That is deliberate: it is predictable, cheap and easy to test, and a successful prompt injection can only produce an odd answer, because the bot has nothing to misuse. Account lookups would need tools, and with them real security risks, so they are left as future work.

### Why search at all, instead of sending every document

The documents are small enough to send on every question, so this was a real choice. Search was chosen because:

- each call costs less: a few sections rather than all of them
- answers can name the exact section they used
- a relevance cutoff can refuse off-topic questions without calling the chat model, which is cheaper and stops it making things up
- it keeps working as the documents grow

The cost is more moving parts: an embedding model, an index to keep up to date, and a cutoff to tune.

### Why pgvector, not a dedicated vector database

Every FoC service with a relational store already uses PostgreSQL, so pgvector adds no new kind of database to run or explain, and the chunks sit beside `chat_log`. At about 120 sections, a dedicated vector database such as Pinecone or Weaviate would add infrastructure for no gain. The cost is a different database image (`pgvector/pgvector:pg18`) from the other services.

No vector index is used: with this few rows, comparing against every row is instant and exact, while the approximate indexes only pay off at far larger sizes.

### Why OpenRouter

One key and one API reach many models, so the chat model is a setting rather than a code change. The cost is one more company handling students' questions, so requests ask to avoid providers that may store them, and users are told their questions go to an outside provider.

### Fixed model names, not an account default

Evaluation results describe the model that produced them. A model chosen in a dashboard could change without anyone noticing and quietly invalidate them.

### Plain fetch, no LLM framework

The pipeline is a few steps, and a framework such as LangChain would add a large dependency for little gain. Splitting is about 20 lines, because the documents follow a strict format.

## Alternatives considered

- **Sending every document on every question.** The simplest option, and the documents are small enough. Rejected for the reasons above: higher cost per question, less precise citations, and no way to stop off-topic questions before a model call.
- **Keyword search (PostgreSQL full-text search).** No outside embedding call, but it matches words rather than meaning, so "new shop" would not find a section about adding a "supplier", and students rarely use the app's exact terms.
- **A dedicated vector database (e.g. Pinecone, Weaviate).** Another kind of database to run, for no gain at this size.
- **An agent with tools.** Could answer account questions, but the model could then trigger real calls, which brings real security risks. Future work.
- **An LLM framework (e.g. LangChain).** A large dependency for a pipeline of a few steps.
- **Calling a model provider directly.** Works, but ties the code to one provider's API, and the embedding and chat models may come from different companies.

## Results

The evaluation in `rag-service/eval/` measures the bot through the real API. On 6 November 2026, with 30 questions, every target was met: 21 of 21 answers named the right section and contained every key fact, 9 of 9 should-refuse questions were refused, and 95% of questions finished within 3.5 seconds. The lowest score for an answerable question was 0.39, so the cutoff stays at 0.3. The numbers, the full report and how far to trust them are in the [service README](../../../rag-service/README.md#8-evaluation).

## Safeguards

| Risk | Safeguard |
|---|---|
| The bot makes things up | A relevance cutoff, answer-only-from-sections rules, and sources taken from our database rather than the model |
| Prompt injection | The question is escaped and treated as data; the bot has no tools or user data |
| Cost or abuse | Login required, a per-user rate limit written before any paid call, a question length limit, an answer length limit, and a spending limit on the key |
| OpenRouter is down or slow | Timeouts and a retryable 503, never a wrong answer. A reply cut off at the token limit gets the same 503, never half an answer. Startup does not wait for it, and keeps retrying the index until it works |
| A bad re-index | Embeddings are fetched before the transaction and the swap is all or nothing, so the old index stays in use |
| Personal data | The user's id only, never email or token. Questions stay out of the logs and are deleted after 30 days |

## Consequences

- Every answer depends on the documents being right. Each service owner reads theirs, and the evaluation in `rag-service/eval/` is rerun after changes.
- Refusing account questions depends on the model following its rules, because these questions match the documents closely enough to pass the cutoff. The evaluation tests this.
- Answers vary slightly between runs, so quality is measured as a score over many questions.
- The per-user rate limit does not stop someone using several accounts, so the spending limit on the key is the real backstop.
- Each question stands alone. Follow-up questions and account lookups are future work.
- `rag-service` is the only service that depends on an outside AI company, and only for this optional feature: if it is down, the rest of FoC is unaffected.
