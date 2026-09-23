# Implementation

## Decision

The email service does not use a web framework. It is a RabbitMQ consumer
written directly against the `amqplib` client, consuming `otp.email` events from
the `otp_emails` queue.

### Rationale

The service's only input is a broker event, not an HTTP request, so it exposes
no web surface at all: there is no endpoint to route, no request lifecycle to
manage, and nothing publicly reachable.
