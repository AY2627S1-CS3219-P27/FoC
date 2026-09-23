# Hashing Algorithm for OTPs/Registration Tokens

## Decision

The user service shall use HMAC-SHA256 hashing for short-lived passwords (OTPs)
and tokens (Registration tokens).

### Rationale

As per
[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#hashing-otps),
hashing short-lived tokens still does not provide strong offline attack
resistance as compared to password hashing, due to the limited search space of
OTPs/tokens. However, hashing is still recommended to prevent accidental
disclosure, enforce good hygiene, and prevent damage of database exposure.

Therefore, we should still hash them. However, the password hashing algorithm
(Argon2id) is deliberately CPU-intensive. If our goal is to prevent
plaintext-at-rest, HMAC-SHA256 with a server secret is perfectly valid - it
allows quick hashes. This prevents users from inadvertently DDOS-ing our
servers.

More discussion
[here](https://github.com/OWASP/ASVS/issues/3313#issuecomment-3639943871)
