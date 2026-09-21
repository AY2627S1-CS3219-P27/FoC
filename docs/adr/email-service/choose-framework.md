# Framework choice for email service

## Decision

The email service shall use ExpressJS as its framework.

### Rationale

The service has a narrow responsibility: receiving email commands or events from
other services and submitting messages to an external email provider. ExpressJS
provides the HTTP functionality required for this purpose without imposing a
large application structure or unnecessary features.
