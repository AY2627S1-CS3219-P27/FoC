# Hashing Algorithm and Parameters choice

## Decision

The user service shall use Argon2id hashing for passwords, with the following
parameters:

- 19Mib memory
- 2 parallel threads
- 2 iterations
- 64-bytes long output

### Rationale

This is in-line with recommendations by a trusted cybersecurity organization,
OWASP. These parameters meet and slightly exceeds their minimum recommendations.
