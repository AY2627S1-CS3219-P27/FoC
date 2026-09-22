# Hashing Algorithm and Parameters choice

## Decision

The user service shall use Argon2id hashing, with the following parameters:

- 19Mib memory
- 2 parallel threads
- 2 iterations
- 64-bytes long output

### Rationale

This is in-line with recommendations by a trusted cybersecurity organization,
OWASP. These parameters meet and slightly exceeds their minimum recommendations.

#### Exception

A notable exception for this is in the output length of the hashing function for
only OTPs. This was done in order to have faster lookups for OTPs, in addition
to the risk surface being smaller due to the ephemeral nature of the OTPs.
