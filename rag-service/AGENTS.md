# rag-service

The FoC help chatbot: answers general questions from the plain-language documents in `../docs/support/`, and names the section each answer came from. It has no access to anyone's account and cannot change anything.

Stack: NestJS 12, PostgreSQL 18 with pgvector via TypeORM (schema changes only through migrations), Joi config, class-validator DTOs, vitest, oxlint. Model calls go to OpenRouter. No RabbitMQ. Run and test commands: see [README.md](README.md).
